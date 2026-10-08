import {Account} from "@prisma/client";
import prisma from "@/lib/prisma";
import {currencyFormatter, toTransactionRow, transactionRowInclude} from "@/lib/transactionRows";
import {jevEnabled} from "@/lib/categorize/jev";
import {TRUSTED_CATEGORY} from "@/lib/categorize/suggest";
import {cashMove, guessTransferAccount, walletMove} from "@/lib/import/plan";
import {parseSelfNames} from "@/lib/import/zelle";
import {personBalances} from "@/lib/people";
import {roundMoney} from "@/lib/ledger";

// What the Sort page shows: transactions waiting for a category, one card per merchant (or
// person), with the likely categories as buttons and, where it fits, a quicker answer:
// "paid you back" for money from someone who owes you, or "a move to Cash" for an ATM line.

const MAX_ITEMS = 300;
const MAX_CHOICES = 4;
const AUTO_SORTED_DAYS = 30;

type Choice = { name: string, type: string, icon: string, probability: number | null };

export async function getSortQueue(userId: string) {
    const formatter = await currencyFormatter(userId);
    const where = {userId, needsReview: true, type: {in: ["income", "expense"]}};
    const [total, transactions, categories, accounts, settings, balances] = await Promise.all([
        prisma.transaction.count({where}),
        prisma.transaction.findMany({where, include: transactionRowInclude, orderBy: [{date: 'desc'}, {createdAt: 'desc'}], take: MAX_ITEMS}),
        prisma.category.findMany({where: {OR: [{userId}, {isUniversal: true}], type: {in: ["income", "expense"]}}}),
        prisma.account.findMany({where: {userId, archived: false}}),
        prisma.userSettings.findUnique({where: {userId}}),
        personBalances(userId),
    ]);
    const selfNames = parseSelfNames(settings?.selfNames);
    const categoryOf = (type: string, name: string) => categories.find((c) => c.type === type && c.name === name);

    // Your most used categories, offered when there is nothing better to suggest
    const usage = await prisma.transaction.groupBy({
        by: ["categoryId"],
        where: {userId, type: {in: ["income", "expense"]}, ...TRUSTED_CATEGORY},
        _count: {_all: true},
        orderBy: {_count: {categoryId: "desc"}},
        take: 20,
    });
    const frequent = (type: string) => usage
        .map((u) => categories.find((c) => c.id === u.categoryId))
        .filter((c): c is typeof categories[number] => Boolean(c && c.type === type && c.name !== "Unsorted" && !c.hidden));

    // A move between your own accounts that was filed as spending or income
    const transferHint = (t: typeof transactions[number]) => {
        const account = accounts.find((a) => a.id === t.accountId);
        if (!account) return null;
        const others = accounts.filter((a) => a.id !== account.id);
        const line = {description: t.description, amount: t.type === "income" ? t.amount : -t.amount};
        const other: Account | null | undefined = cashMove(line, account, others) ?? walletMove(line, others, selfNames)
            ?? guessTransferAccount(line, account, others);
        if (!other) return null;
        return {accountId: other.id, accountName: other.name, fromAccountName: account.name, into: t.type === "expense"};
    };

    const groups = new Map<string, typeof transactions>();
    for (const t of transactions) {
        const key = `${t.type}:${t.personId ? `person:${t.personId}` : t.payeeKey ? `payee:${t.payeeKey}` : `id:${t.id}`}`;
        groups.set(key, [...(groups.get(key) ?? []), t]);
    }

    const cards = [...groups.entries()].map(([key, group]) => {
        const first = group[0];
        const choices: Choice[] = [];
        const add = (name: string, probability: number | null) => {
            const category = categoryOf(first.type, name);
            if (category && name !== "Unsorted" && !choices.some((c) => c.name === name) && choices.length < MAX_CHOICES) {
                choices.push({name, type: category.type, icon: category.icon, probability});
            }
        };
        // The current guess first, then Jev's other likely answers, then your usual categories
        add(first.category.name, first.categorizedBy === "ai" ? first.categoryConfidence : null);
        const ai = Array.isArray(first.aiSuggestions) ? first.aiSuggestions as { name: string, probability: number }[] : [];
        for (const s of ai) add(s.name, s.probability);
        for (const c of frequent(first.type)) add(c.name, null);

        const owes = first.person ? balances.get(first.person.id) ?? 0 : 0;
        const rows = group.map((t) => toTransactionRow(t, formatter));
        return {
            key,
            ids: group.map((t) => t.id),
            type: first.type as "income" | "expense",
            rows,
            name: rows[0].name,
            total: roundMoney(group.reduce((sum, t) => sum + t.amount, 0)),
            // The suggestion shown as the main button, when there is one
            suggested: first.category.name !== "Unsorted" ? choices[0]?.name ?? null : null,
            choices,
            person: first.person ? {...first.person, owes} : null,
            paidBack: first.type === "income" && owes > 0,
            transfer: transferHint(first),
            // A rule can be made from the merchant or the person
            canAlways: Boolean(first.personId || first.payeeKey),
        };
    });

    return {aiEnabled: jevEnabled(), total, cards};
}

export type SortQueue = Awaited<ReturnType<typeof getSortQueue>>;
export type SortCard = SortQueue["cards"][number];

// What Pennywise filed by itself lately, to spot-check
export async function getAutoSorted(userId: string) {
    const formatter = await currencyFormatter(userId);
    const transactions = await prisma.transaction.findMany({
        where: {
            userId, needsReview: false, type: {in: ["income", "expense"]},
            categorizedBy: {in: ["rule", "history", "keyword", "bank", "ai"]},
            createdAt: {gte: new Date(Date.now() - AUTO_SORTED_DAYS * 24 * 60 * 60 * 1000)},
        },
        include: transactionRowInclude,
        orderBy: [{createdAt: "desc"}, {date: "desc"}],
        take: 150,
    });
    return transactions.map((t) => ({...toTransactionRow(t, formatter), categorizedBy: t.categorizedBy}));
}

export type AutoSortedRow = Awaited<ReturnType<typeof getAutoSorted>>[number];
