import prisma from "@/lib/prisma";
import {authenticateDevice, categoryLabel, NEW_PLACE, SORT_LATER} from "@/lib/capture";

export const dynamic = "force-dynamic";

const PLACES = 15;
const CATEGORIES = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

function byUse<T>(items: T[], key: (item: T) => string | null) {
    const counts = new Map<string, number>();
    for (const item of items) {
        const k = key(item);
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

// The lists the "Log a purchase" shortcut picks from, most used first:
//   GET /api/capture/options  Authorization: Bearer <key>
//   {"places": [..., "New place…"], "accounts": [...], "categories": ["🛒 Groceries", ..., "Sort later"]}
export async function GET(request: Request) {
    const auth = await authenticateDevice(request);
    if ("response" in auth) return auth.response;
    const userId = auth.key.userId;

    const since = new Date(Date.now() - 180 * DAY_MS);
    const [recent, accounts, categories] = await Promise.all([
        prisma.transaction.findMany({
            where: {userId, type: "expense", date: {gte: since}},
            select: {description: true, source: true, accountId: true, categoryId: true},
        }),
        prisma.account.findMany({where: {userId, archived: false, type: {in: ["checking", "credit", "cash", "wallet"]}}}),
        prisma.category.findMany({where: {type: "expense", hidden: false, OR: [{userId}, {isUniversal: true}], NOT: {name: "Unsorted"}}}),
    ]);

    // Places you logged yourself have clean names; statement lines don't
    const logged = recent.filter((t) => t.source !== "import" && t.source !== "plaid");
    const places = byUse(logged, (t) => t.description.trim() || null).slice(0, PLACES);
    const accountOrder = byUse(recent, (t) => t.accountId);
    const categoryOrder = byUse(recent, (t) => t.categoryId);
    const rank = (order: string[], id: string) => {
        const i = order.indexOf(id);
        return i === -1 ? order.length : i;
    };

    return Response.json({
        places: [...places, NEW_PLACE],
        accounts: accounts
            .sort((a, b) => rank(accountOrder, a.id) - rank(accountOrder, b.id) || a.name.localeCompare(b.name))
            .map((a) => a.name),
        categories: [
            ...categories
                .sort((a, b) => rank(categoryOrder, a.id) - rank(categoryOrder, b.id) || a.name.localeCompare(b.name))
                .slice(0, CATEGORIES)
                .map(categoryLabel),
            ...SORT_LATER,
        ],
    });
}
