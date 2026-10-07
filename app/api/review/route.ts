import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";
import {currencyFormatter, toTransactionRow, transactionRowInclude} from "@/lib/transactionRows";
import {jevEnabled} from "@/lib/categorize/jev";
import {TRUSTED_CATEGORY} from "@/lib/categorize/suggest";

export async function GET() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }
    return Response.json(await getReviewQueue(user.id));
}

export type GetReviewQueueResponseType = Awaited<ReturnType<typeof getReviewQueue>>

const MAX_ITEMS = 200;
const MAX_CHOICES = 4;

type Choice = { name: string, icon: string, probability: number | null };

async function getReviewQueue(userId: string) {
    const formatter = await currencyFormatter(userId);

    const where = {userId, needsReview: true, type: {in: ["income", "expense"]}};
    const [total, transactions, categories] = await Promise.all([
        prisma.transaction.count({where}),
        prisma.transaction.findMany({
            where,
            include: transactionRowInclude,
            orderBy: [{date: 'desc'}, {createdAt: 'desc'}],
            take: MAX_ITEMS,
        }),
        prisma.category.findMany({where: {OR: [{userId}, {isUniversal: true}], type: {in: ["income", "expense"]}}}),
    ]);

    const iconOf = (type: string, name: string) => categories.find((c) => c.type === type && c.name === name)?.icon ?? "❓";

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
        .filter((c): c is typeof categories[number] => Boolean(c && c.type === type && c.name !== "Unsorted"));

    const pendingByMerchant = new Map<string, number>();
    for (const t of transactions) {
        if (t.payeeKey) pendingByMerchant.set(`${t.type}:${t.payeeKey}`, (pendingByMerchant.get(`${t.type}:${t.payeeKey}`) ?? 0) + 1);
    }

    const items = transactions.map((t) => {
        const choices: Choice[] = [];
        const add = (name: string, probability: number | null) => {
            if (name !== "Unsorted" && !choices.some((c) => c.name === name) && choices.length < MAX_CHOICES) {
                choices.push({name, icon: iconOf(t.type, name), probability});
            }
        };
        // The current guess first, then Jev's other likely answers, then your usual categories
        add(t.category.name, t.categorizedBy === "ai" ? t.categoryConfidence : null);
        const ai = Array.isArray(t.aiSuggestions) ? t.aiSuggestions as { name: string, probability: number }[] : [];
        for (const s of ai) add(s.name, s.probability);
        for (const c of frequent(t.type)) add(c.name, null);

        return {
            ...toTransactionRow(t, formatter),
            categorizedBy: t.categorizedBy,
            confidence: t.categoryConfidence,
            choices,
            // Other transactions from the same merchant still waiting to be sorted
            sameMerchant: t.payeeKey ? (pendingByMerchant.get(`${t.type}:${t.payeeKey}`) ?? 1) - 1 : 0,
        };
    });

    return {aiEnabled: jevEnabled(), total, items};
}
