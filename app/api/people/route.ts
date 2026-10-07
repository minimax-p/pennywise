import {requireUser} from "@/lib/actionResult";
import prisma from "@/lib/prisma";
import {linkZellePeople, owedTotals, personBalances} from "@/lib/people";
import {currencyFormatter, toTransactionRow, transactionRowInclude} from "@/lib/transactionRows";

export const dynamic = "force-dynamic";

const RECENT_COUNT = 15;

// Everyone you've sent money to or got money from, what they owe you, and recent payments
export async function GET() {
    const user = await requireUser();
    await linkZellePeople(user.id);
    const [people, balances, recent, formatter] = await Promise.all([
        prisma.person.findMany({
            where: {userId: user.id},
            include: {
                transactions: {orderBy: [{date: "desc"}, {createdAt: "desc"}], take: 1, select: {date: true, note: true}},
                _count: {select: {transactions: true, lines: true}},
            },
        }),
        personBalances(user.id),
        prisma.transaction.findMany({
            where: {userId: user.id, personId: {not: null}},
            include: transactionRowInclude,
            orderBy: [{date: "desc"}, {createdAt: "desc"}],
            take: RECENT_COUNT,
        }),
        currencyFormatter(user.id),
    ]);

    const list = people.map((p) => ({
        id: p.id,
        name: p.name,
        aliases: p.aliases,
        balance: balances.get(p.id) ?? 0,
        lastDate: p.transactions[0]?.date ?? null,
        lastNote: p.transactions[0]?.note ?? null,
        count: p._count.transactions,
        hasShares: p._count.lines > 0,
    }));
    // People with money between you first, then the most recent
    list.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)
        || (b.lastDate?.getTime() ?? 0) - (a.lastDate?.getTime() ?? 0)
        || a.name.localeCompare(b.name));

    return Response.json({
        totals: owedTotals(balances),
        people: list,
        recent: recent.map((t) => toTransactionRow(t, formatter)),
    });
}

export type GetPeopleResponseType = {
    totals: ReturnType<typeof owedTotals>,
    people: {
        id: string, name: string, aliases: string[], balance: number, lastDate: string | null,
        lastNote: string | null, count: number, hasShares: boolean,
    }[],
    recent: ReturnType<typeof toTransactionRow>[],
};
