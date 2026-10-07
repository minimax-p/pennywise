import {requireUser} from "@/lib/actionResult";
import prisma from "@/lib/prisma";
import {payeeKey} from "@/lib/payee";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export type Merchant = {
    name: string;
    type: "income" | "expense";
    count: number;
    // How you paid and the category you used last time
    accountId: string | null;
    category: { name: string, type: string, icon: string } | null;
};

export type GetMerchantsResponseType = Merchant[];

// Places you've spent at and sources of money, most used first, for the Log sheet to
// suggest as you type and fill in how you paid and the category from last time
export async function GET() {
    const user = await requireUser();
    const transactions = await prisma.transaction.findMany({
        where: {userId: user.id, type: {in: ["income", "expense"]}, date: {gte: new Date(Date.now() - 365 * DAY_MS)}},
        orderBy: [{date: "desc"}, {createdAt: "desc"}],
        select: {
            description: true, type: true, source: true, accountId: true, needsReview: true, payeeKey: true,
            category: {select: {name: true, type: true, icon: true}},
        },
        take: 3000,
    });

    const merchants = new Map<string, Merchant & { logged: boolean }>();
    for (const t of transactions) {
        const name = t.description.trim();
        if (!name) continue;
        const key = `${t.type}:${t.payeeKey ?? payeeKey(name) ?? name.toUpperCase()}`;
        const logged = t.source !== "import" && t.source !== "plaid";
        const known = t.category.type === "income" || t.category.type === "expense";
        const usable = !t.needsReview && known && t.category.name !== "Unsorted";
        const entry = merchants.get(key);
        if (!entry) {
            merchants.set(key, {
                name, type: t.type as Merchant["type"], count: 1, logged,
                accountId: t.accountId, category: usable ? t.category : null,
            });
            continue;
        }
        entry.count++;
        // A name you typed reads better than a statement's
        if (logged && !entry.logged) {
            entry.name = name;
            entry.logged = true;
        }
        if (!entry.category && usable) entry.category = t.category;
        if (!entry.accountId) entry.accountId = t.accountId;
    }

    const list: GetMerchantsResponseType = [...merchants.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 400)
        .map(({logged: _, ...m}) => m);
    return Response.json(list);
}
