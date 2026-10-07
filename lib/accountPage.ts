import prisma from "@/lib/prisma";
import {accountGroup, checkStatus, intervalSummary, loadLedger} from "@/lib/accounts";
import {CENT, signedAmount} from "@/lib/ledger";
import {currencyFormatter, toTransactionRow, transactionRowInclude} from "@/lib/transactionRows";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 3000;
const MAX_MISMATCHES = 20;

// One account like a bank app shows it: transactions with a running balance, the
// balances you checked, and every stretch where the transactions don't add up.
// `days` limits the transactions to recent ones; 0 shows all.
export async function getAccountPage(userId: string, accountId: string, days: number) {
    const account = await prisma.account.findFirst({
        where: {id: accountId, userId},
        select: {
            id: true, name: true, type: true, institution: true, walletCardName: true,
            apy: true, maturesOn: true, archived: true, createdAt: true,
        },
    });
    if (!account) return null;

    const ledger = await loadLedger(accountId);
    const formatter = await currencyFormatter(userId);
    const since = days > 0 ? new Date(Date.now() - days * DAY_MS) : null;
    const onAccount = {userId, OR: [{accountId}, {toAccountId: accountId}]};
    const [transactions, olderCount, statementRange] = await Promise.all([
        prisma.transaction.findMany({
            where: {...onAccount, ...(since ? {date: {gte: since}} : {})},
            include: transactionRowInclude,
            orderBy: [{date: 'desc'}, {createdAt: 'desc'}],
            take: MAX_ROWS,
        }),
        since ? prisma.transaction.count({where: {...onAccount, date: {lt: since}}}) : Promise.resolve(0),
        prisma.balanceCheck.aggregate({
            where: {accountId, source: "statement"},
            _min: {date: true}, _max: {date: true}, _count: {_all: true},
        }),
    ]);

    // Checks you typed, newest first, each compared with the check before it
    const checks = ledger.intervals
        .filter((i) => i.to.source === "you")
        .map((i) => ({id: i.to.id, date: i.to.date.toISOString(), balance: i.to.balance, source: i.to.source, difference: i.difference}));
    const first = ledger.intervals[0]?.from ?? ledger.latestCheck;
    if (first && first.source === "you") {
        checks.unshift({id: first.id, date: first.date.toISOString(), balance: first.balance, source: first.source, difference: 0});
    }
    checks.reverse();

    return {
        account: {
            ...account,
            group: accountGroup(account.type),
            balance: ledger.balance,
            check: checkStatus(ledger),
        },
        rows: transactions.map((t) => ({
            ...toTransactionRow(t, formatter),
            // Effect on this account (negative when money left it) and the balance after it
            effect: signedAmount(t, accountId),
            runningBalance: ledger.runningBalances.get(t.id) ?? null,
        })),
        olderCount,
        checks,
        statements: statementRange._count._all > 0 ? {
            count: statementRange._count._all,
            from: statementRange._min.date!.toISOString(),
            to: statementRange._max.date!.toISOString(),
        } : null,
        mismatches: ledger.intervals
            .filter((i) => Math.abs(i.difference) >= CENT)
            .slice(-MAX_MISMATCHES)
            .reverse()
            .map(intervalSummary),
    };
}

export type AccountPageData = NonNullable<Awaited<ReturnType<typeof getAccountPage>>>;
