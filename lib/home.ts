import prisma from "@/lib/prisma";
import {ACCOUNT_GROUPS, listAccounts} from "@/lib/accounts";
import {roundMoney} from "@/lib/ledger";
import {getCategoryTotals, getDailySpending, getTotals} from "@/lib/reports";
import {currencyFormatter, toTransactionRow, transactionRowInclude} from "@/lib/transactionRows";

// Everything Home shows, in one request. Balances are always as of now; the month
// numbers use calendar months in the server's time zone (TZ).

// An account counts as unchecked after this long without a balance check
export const STALE_CHECK_DAYS = 14;
const RECENT_COUNT = 8;
const TOP_CATEGORIES = 5;

// Transaction dates keep the local calendar day in their UTC fields
function utcDay(year: number, month: number, day: number) {
    return new Date(Date.UTC(year, month, day));
}

// Running total per day of a month, through `lastDay`
function cumulative(days: Map<string, number>, year: number, month: number, lastDay: number) {
    const points: { day: number, total: number }[] = [];
    let total = 0;
    for (let day = 1; day <= lastDay; day++) {
        total += days.get(utcDay(year, month, day).toISOString().slice(0, 10)) ?? 0;
        points.push({day, total: roundMoney(total)});
    }
    return points;
}

export async function getHome(userId: string, now = new Date()) {
    const accounts = (await listAccounts(userId, now)).filter((a) => !a.archived);
    const sum = (list: typeof accounts) => roundMoney(list.reduce((total, a) => total + a.balance, 0));
    const inGroup = (id: string) => accounts.filter((a) => a.group === id);

    // Spending money: cash and checking, minus what the cards owe
    const spendingAccounts = [...inGroup("spending"), ...inGroup("credit")];

    const year = now.getFullYear(), month = now.getMonth(), today = now.getDate();
    const monthStart = utcDay(year, month, 1);
    const todayEnd = new Date(utcDay(year, month, today + 1).getTime() - 1);
    const lastMonthStart = utcDay(year, month - 1, 1);
    const lastMonthEnd = new Date(monthStart.getTime() - 1);
    const daysLastMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const daysThisMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const formatter = await currencyFormatter(userId);
    const [thisMonth, categories, thisDays, lastDays, recent, toSort] = await Promise.all([
        getTotals(userId, monthStart, todayEnd),
        getCategoryTotals(userId, monthStart, todayEnd),
        getDailySpending(userId, monthStart, todayEnd),
        getDailySpending(userId, lastMonthStart, lastMonthEnd),
        prisma.transaction.findMany({
            where: {userId},
            include: transactionRowInclude,
            orderBy: [{date: 'desc'}, {createdAt: 'desc'}],
            take: RECENT_COUNT,
        }),
        prisma.transaction.count({where: {userId, needsReview: true, type: {in: ["income", "expense"]}}}),
    ]);

    const lastMonthPace = cumulative(lastDays, lastMonthStart.getUTCFullYear(), lastMonthStart.getUTCMonth(), daysLastMonth);
    const lastMonthSoFar = lastMonthPace[Math.min(today, daysLastMonth) - 1]?.total ?? 0;

    return {
        totals: {
            spendingMoney: sum(spendingAccounts),
            savings: sum(inGroup("savings")),
            netWorth: sum(accounts),
        },
        // The accounts that make up Spending money, to show the math
        spendingParts: spendingAccounts.map((a) => ({id: a.id, name: a.name, type: a.type, balance: a.balance})),
        groups: ACCOUNT_GROUPS.map((g) => ({
            id: g.id,
            label: g.label,
            total: sum(inGroup(g.id)),
            accounts: inGroup(g.id),
        })).filter((g) => g.accounts.length > 0),
        // Accounts with transactions whose balance hasn't been compared with the bank lately
        staleAccounts: accounts
            .filter((a) => a.transactionCount > 0 && (a.check.daysSinceCheck === null || a.check.daysSinceCheck >= STALE_CHECK_DAYS))
            .map((a) => ({id: a.id, name: a.name, daysSinceCheck: a.check.daysSinceCheck})),
        mismatchedAccounts: accounts
            .filter((a) => a.check.mismatch)
            .map((a) => ({id: a.id, name: a.name, mismatch: a.check.mismatch!})),
        month: {
            start: monthStart.toISOString(),
            spent: thisMonth.spending,
            income: thisMonth.income,
            lastMonthSoFar,
            lastMonthTotal: lastMonthPace[lastMonthPace.length - 1]?.total ?? 0,
            daysInMonth: daysThisMonth,
            pace: cumulative(thisDays, year, month, today),
            lastMonthPace,
        },
        topCategories: categories.spending.slice(0, TOP_CATEGORIES),
        recent: recent.map((t) => toTransactionRow(t, formatter)),
        toSort,
        hasAccounts: accounts.length > 0,
    };
}

export type HomeData = Awaited<ReturnType<typeof getHome>>;
