import {Account, Prisma} from "@prisma/client";
import prisma from "@/lib/prisma";
import {payeeKey, payeesSimilar} from "@/lib/payee";
import {fingerprintRows, StatementRow} from "@/lib/import/parse";
import {categorizationFields, CategorySuggestion, suggestCategories} from "@/lib/categorize/suggest";
import {getTransferCategory} from "@/lib/accounts";
import {applyHistoryChanges} from "@/lib/history";

// Decides what to do with each statement line before anything is saved:
// - duplicate:  imported before (same line, or the same purchase from a CSV and a QFX file)
// - match:      a transaction you entered by hand or via Apple Pay; the import fills in the bank's amount
// - transfer:   the other side of a transfer already recorded from the other account's statement
// - pair:       an expense or income in another account that is really the other side of a transfer
// - new:        a new expense, income or transfer

export type PlanStatus = "new" | "duplicate" | "match" | "transfer" | "pair" | "skip";

export type PlanRow = {
    fingerprint: string;
    date: string;
    amount: number;
    description: string;
    status: PlanStatus;
    // Imported unless unticked; duplicates and skipped lines start unticked
    include: boolean;
    // What a new row becomes
    kind: "income" | "expense" | "transfer";
    category: string | null;
    // Where the suggested category came from; a different category means you picked it
    suggestion: CategorySuggestion | null;
    // For transfers, the user's other account
    transferAccountId: string | null;
    // For match, transfer and pair: the existing transaction it is joined to
    linkTransactionId: string | null;
    // Shown in the preview, e.g. why a line was matched or skipped
    note: string | null;
};

const TRANSFER_WORDS = /\b(TRANSFER|XFER|PAYMENT|PYMT|PMT|E-PAYMENT|EPAYMENT|AUTOPAY|AUTO PAY|CASHOUT|CASH OUT|DEPOSIT FROM|WITHDRAWAL TO|THANK YOU)\b/i;
const TRANSFER_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date) {
    return Math.abs(a.getTime() - b.getTime()) / DAY_MS;
}

function sameAmount(a: number, b: number) {
    return Math.abs(Math.abs(a) - Math.abs(b)) < 0.005;
}

function formatDay(date: Date) {
    return date.toISOString().slice(0, 10);
}

// Another of the user's accounts that a transfer line seems to name
function guessTransferAccount(row: StatementRow, account: Account, others: Account[]): Account | null {
    if (!TRANSFER_WORDS.test(row.description)) return null;
    const text = row.description.toUpperCase();
    const named = others.find((other) => [other.institution, other.name]
        .filter((name): name is string => Boolean(name && name.length > 2))
        .some((name) => text.includes(name.toUpperCase())));
    // "VENMO PAYMENT" on a bank statement is paying someone through Venmo, which is
    // spending; only a cash-out moves money between the two accounts
    if (named && /VENMO/.test(text) && !/CASHOUT|CASH OUT|TRANSFER/.test(text)) return null;
    if (named) return named;
    // A payment arriving on a credit card most likely came from checking
    if (account.type === "credit" && row.amount > 0) {
        return others.find((other) => other.type === "checking") ?? null;
    }
    return null;
}

export async function planImport(userId: string, account: Account, rows: StatementRow[]): Promise<PlanRow[]> {
    const fingerprints = fingerprintRows(rows);
    const imported = new Set((await prisma.importedRow.findMany({
        where: {accountId: account.id, fingerprint: {in: fingerprints}},
        select: {fingerprint: true},
    })).map((r) => r.fingerprint));

    const others = await prisma.account.findMany({where: {userId, id: {not: account.id}, archived: false}});

    // Transactions near the statement's dates that a line could be joined to
    const times = rows.map((r) => r.date.getTime());
    const window = rows.length === 0 ? null : {
        gte: new Date(Math.min(...times) - 10 * DAY_MS),
        lte: new Date(Math.max(...times) + 10 * DAY_MS),
    };
    const nearby = window ? await prisma.transaction.findMany({
        where: {
            userId,
            date: window,
            OR: [{accountId: account.id}, {toAccountId: account.id}, {accountId: {in: others.map((o) => o.id)}}],
        },
        include: {importedRows: {select: {accountId: true}}},
    }) : [];
    const reconciledHere = (t: typeof nearby[number]) => t.importedRows.some((r) => r.accountId === account.id);

    const used = new Set<string>();
    const claim = (id: string) => used.add(id);

    const plan = rows.map((row, i): PlanRow => {
        const base = {
            fingerprint: fingerprints[i],
            date: row.date.toISOString(),
            amount: row.amount,
            description: row.description,
            kind: (row.amount > 0 ? "income" : "expense") as PlanRow["kind"],
            category: null,
            suggestion: null,
            transferAccountId: null,
            linkTransactionId: null,
        };

        if (imported.has(fingerprints[i])) {
            return {...base, status: "duplicate", include: false, note: "Already imported"};
        }

        if (row.skipReason) {
            return {...base, status: "skip", include: false, note: row.skipReason};
        }

        // The same purchase imported before from a different file format
        const probableDuplicate = nearby.find((t) =>
            !used.has(t.id) && t.accountId === account.id && t.type !== "transfer" && reconciledHere(t)
            && sameAmount(t.amount, row.amount) && daysBetween(t.date, row.date) <= 1
            && (t.type === "income") === (row.amount > 0)
            && (payeesSimilar(t.description, row.description) || (t.payeeKey !== null && t.payeeKey === payeeKey(row.description))));
        if (probableDuplicate) {
            claim(probableDuplicate.id);
            return {...base, status: "duplicate", include: false, note: `Looks like "${probableDuplicate.description}", already imported`};
        }

        // A transfer recorded from the other account, waiting for this side
        const transfer = nearby.find((t) =>
            !used.has(t.id) && t.type === "transfer" && !reconciledHere(t)
            && (row.amount < 0 ? t.accountId === account.id : t.toAccountId === account.id)
            && sameAmount(t.amount, row.amount) && daysBetween(t.date, row.date) <= TRANSFER_DAYS);
        if (transfer) {
            claim(transfer.id);
            return {
                ...base, status: "transfer", include: true, kind: "transfer", category: null,
                linkTransactionId: transfer.id,
                transferAccountId: row.amount < 0 ? transfer.toAccountId : transfer.accountId,
                note: "Other side of a transfer already recorded",
            };
        }

        // An expense or income in another account that mirrors this line
        const mirror = nearby.find((t) =>
            !used.has(t.id) && t.type === (row.amount > 0 ? "expense" : "income")
            && t.accountId !== null && t.accountId !== account.id
            && sameAmount(t.amount, row.amount) && daysBetween(t.date, row.date) <= TRANSFER_DAYS
            && (TRANSFER_WORDS.test(row.description) || TRANSFER_WORDS.test(t.description)));
        if (mirror) {
            claim(mirror.id);
            const other = others.find((o) => o.id === mirror.accountId);
            return {
                ...base, status: "pair", include: true, kind: "transfer", category: null,
                linkTransactionId: mirror.id, transferAccountId: mirror.accountId,
                note: `Turns "${mirror.description}" in ${other?.name ?? "another account"} into a transfer`,
            };
        }

        // Entered by hand or by the Apple Pay shortcut; bank amounts can include a tip added later
        const candidates = nearby.filter((t) =>
            !used.has(t.id) && t.accountId === account.id && t.type !== "transfer" && !reconciledHere(t)
            && (t.source === "manual" || t.source === "apple_pay")
            && (t.type === "income") === (row.amount > 0)
            && row.date.getTime() - t.date.getTime() >= -2 * DAY_MS
            && row.date.getTime() - t.date.getTime() <= 7 * DAY_MS);
        const entered = candidates
            .filter((t) => sameAmount(t.amount, row.amount))
            .sort((a, b) => daysBetween(a.date, row.date) - daysBetween(b.date, row.date))[0]
            ?? candidates.find((t) =>
                t.type === "expense" && Math.abs(row.amount) > t.amount && Math.abs(row.amount) <= t.amount * 1.35
                && payeesSimilar(t.description, row.description));
        if (entered) {
            claim(entered.id);
            const changed = !sameAmount(entered.amount, row.amount);
            return {
                ...base, status: "match", include: true, linkTransactionId: entered.id,
                note: `Matches "${entered.description}" from ${formatDay(entered.date)}`
                    + (changed ? `, amount updated from ${entered.amount.toFixed(2)}` : ""),
            };
        }

        const transferAccount = guessTransferAccount(row, account, others);
        if (transferAccount) {
            return {
                ...base, status: "new", include: true, kind: "transfer", category: null,
                transferAccountId: transferAccount.id,
                note: `Transfer ${row.amount < 0 ? "to" : "from"} ${transferAccount.name}?`,
            };
        }

        return {...base, status: "new", include: true, note: null};
    });

    // Categories for every line, in case one is switched to income or expense in the
    // preview; only new income and expense lines are sent to Jev
    const suggestions = await suggestCategories(
        userId,
        rows.map((row) => ({...row, accountName: account.name, accountType: account.type})),
        (i) => plan[i].status === "new" && plan[i].kind !== "transfer",
    );
    return plan.map((row, i) => row.linkTransactionId
        ? row
        : {...row, category: suggestions[i].name, suggestion: suggestions[i]});
}

export type CommitResult = { created: number, linked: number, skipped: number };

// Saves the rows the user kept. Lines imported in the meantime are skipped.
export async function commitImport(userId: string, account: Account, rows: PlanRow[]): Promise<CommitResult> {
    const result: CommitResult = {created: 0, linked: 0, skipped: 0};
    const transferCategory = await getTransferCategory();
    for (const type of ["income", "expense"]) {
        if (!await prisma.category.findFirst({where: {name: "Unsorted", type, isUniversal: true}})) {
            await prisma.category.create({data: {name: "Unsorted", icon: "❓", type, isUniversal: true}});
        }
    }
    const categories = await prisma.category.findMany({
        where: {OR: [{userId}, {isUniversal: true}], type: {in: ["income", "expense"]}},
    });
    const categoryId = (type: string, name: string | null) =>
        (categories.find((c) => c.type === type && c.name === name && c.userId === userId)
            ?? categories.find((c) => c.type === type && c.name === name)
            ?? categories.find((c) => c.type === type && c.name === "Unsorted" && c.isUniversal))!.id;
    const ownAccounts = new Set((await prisma.account.findMany({where: {userId}, select: {id: true}})).map((a) => a.id));

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const already = new Set((await tx.importedRow.findMany({
            where: {accountId: account.id, fingerprint: {in: rows.map((r) => r.fingerprint)}},
            select: {fingerprint: true},
        })).map((r) => r.fingerprint));

        for (const row of rows) {
            if (!row.include || already.has(row.fingerprint)) {
                result.skipped++;
                continue;
            }
            const date = new Date(row.date);
            const amount = Math.abs(row.amount);
            let transactionId: string;

            if (row.linkTransactionId) {
                const existing = await tx.transaction.findFirst({where: {id: row.linkTransactionId, userId}});
                const valid = existing && (
                    (row.status === "match" && existing.accountId === account.id && existing.type !== "transfer")
                    || (row.status === "transfer" && existing.type === "transfer"
                        && (existing.accountId === account.id || existing.toAccountId === account.id))
                    || (row.status === "pair" && existing.type !== "transfer"
                        && existing.accountId !== null && existing.accountId !== account.id && ownAccounts.has(existing.accountId))
                );
                if (!existing || !valid) {
                    result.skipped++;
                    continue;
                }
                if (row.status === "match") {
                    // The bank's amount and date are final (tips, holds)
                    await tx.transaction.update({where: {id: existing.id}, data: {amount, date}});
                    await applyHistoryChanges(tx, userId, [
                        {date: existing.date, type: existing.type, amount: -existing.amount},
                        {date, type: existing.type, amount},
                    ]);
                } else if (row.status === "pair") {
                    // The mirrored expense or income becomes one transfer between the two accounts
                    const otherId = existing.accountId!;
                    await tx.transaction.update({
                        where: {id: existing.id},
                        data: {
                            type: "transfer",
                            categoryId: transferCategory.id,
                            accountId: row.amount < 0 ? account.id : otherId,
                            toAccountId: row.amount < 0 ? otherId : account.id,
                            payeeKey: null,
                        },
                    });
                    await applyHistoryChanges(tx, userId, [{date: existing.date, type: existing.type, amount: -existing.amount}]);
                }
                transactionId = existing.id;
                result.linked++;
            } else if (row.kind === "transfer") {
                if (!row.transferAccountId || !ownAccounts.has(row.transferAccountId) || row.transferAccountId === account.id) {
                    result.skipped++;
                    continue;
                }
                const created = await tx.transaction.create({
                    data: {
                        userId, amount, date, description: row.description, type: "transfer", source: "import",
                        categoryId: transferCategory.id,
                        accountId: row.amount < 0 ? account.id : row.transferAccountId,
                        toAccountId: row.amount < 0 ? row.transferAccountId : account.id,
                    },
                });
                transactionId = created.id;
                result.created++;
            } else {
                const type = row.kind;
                const category = row.category ?? "Unsorted";
                // Changing the suggested category in the preview counts as sorting it yourself
                const pickedByYou = !row.suggestion || row.suggestion.name !== category;
                const created = await tx.transaction.create({
                    data: {
                        userId, amount, date, description: row.description, type, source: "import",
                        categoryId: categoryId(type, category),
                        accountId: account.id,
                        payeeKey: payeeKey(row.description),
                        ...(pickedByYou
                            ? {categorizedBy: "you", needsReview: category === "Unsorted"}
                            : categorizationFields(row.suggestion!)),
                    },
                });
                await applyHistoryChanges(tx, userId, [{date, type, amount}]);
                transactionId = created.id;
                result.created++;
            }

            await tx.importedRow.create({data: {accountId: account.id, fingerprint: row.fingerprint, transactionId}});
        }
    }, {maxWait: 10_000, timeout: 120_000});

    return result;
}
