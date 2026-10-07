// Balances from balance checks and transactions, without touching the database.
//
// A balance check is a balance the bank showed at a moment. The current balance is the
// latest check plus the transactions dated after it, so importing older statements never
// shifts it. Each pair of neighbouring checks verifies the transactions between them: they
// should add up to the bank's change in balance, and any difference points at a missing or
// wrong transaction in that stretch.

export type LedgerTransaction = {
    id: string;
    date: Date;
    createdAt: Date;
    type: string;
    amount: number;
    accountId: string | null;
    toAccountId: string | null;
};

export type LedgerCheck = {
    id: string;
    date: Date;
    createdAt: Date;
    balance: number;
    source: string;
};

export type CheckInterval = {
    from: LedgerCheck;
    to: LedgerCheck;
    // What the transactions between the two checks add up to, starting from `from`
    expected: number;
    // to.balance - expected; zero when everything adds up
    difference: number;
    // Transactions dated in (from.date, to.date]
    transactionCount: number;
};

export type Ledger = {
    balance: number;
    latestCheck: LedgerCheck | null;
    intervals: CheckInterval[];
    // Balance right after each transaction, keyed by transaction id
    runningBalances: Map<string, number>;
    // Balance at a moment, anchored on the nearest check
    balanceAt: (date: Date) => number;
};

export function roundMoney(value: number) {
    // "+ 0" turns -0 into 0
    return Math.round(value * 100) / 100 + 0;
}

// Within this, two amounts are the same
export const CENT = 0.005;

// Effect of a transaction on one account: income adds and expenses subtract; transfers
// and adjustments subtract from accountId and add to toAccountId
export function signedAmount(t: Pick<LedgerTransaction, "type" | "amount" | "accountId" | "toAccountId">, accountId: string): number {
    let effect = 0;
    if (t.accountId === accountId) {
        effect += t.type === "income" ? t.amount : -t.amount;
    }
    if ((t.type === "transfer" || t.type === "adjustment") && t.toAccountId === accountId) {
        effect += t.amount;
    }
    return effect;
}

const byTime = (a: { date: Date, createdAt: Date, id: string }, b: { date: Date, createdAt: Date, id: string }) =>
    a.date.getTime() - b.date.getTime()
    || a.createdAt.getTime() - b.createdAt.getTime()
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildLedger(accountId: string, transactions: LedgerTransaction[], checks: LedgerCheck[]): Ledger {
    const txns = transactions
        .filter((t) => t.accountId === accountId || t.toAccountId === accountId)
        .sort(byTime);
    const sortedChecks = [...checks].sort(byTime);

    // prefix[i] = sum of the first i transactions' effects
    const prefix = [0];
    for (const t of txns) prefix.push(prefix[prefix.length - 1] + signedAmount(t, accountId));

    // Number of transactions dated at or before a moment
    const countUpTo = (date: Date) => {
        let lo = 0, hi = txns.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (txns[mid].date.getTime() <= date.getTime()) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };
    const checkCounts = sortedChecks.map((c) => countUpTo(c.date));
    const latestIndex = sortedChecks.length - 1;

    const forwardFrom = (k: number, n: number) => sortedChecks[k].balance + prefix[n] - prefix[checkCounts[k]];
    const backwardFrom = (k: number, n: number) => sortedChecks[k].balance - (prefix[checkCounts[k]] - prefix[n]);

    // Balance right after the first n transactions: worked back from the first check at or
    // after them, the way a statement's running balance reads, or carried forward from the
    // latest check
    const runningAfter = (n: number) => {
        const next = checkCounts.findIndex((count) => count >= n);
        if (next !== -1) return backwardFrom(next, n);
        if (latestIndex >= 0) return forwardFrom(latestIndex, n);
        return prefix[n];
    };

    const runningBalances = new Map<string, number>();
    txns.forEach((t, i) => runningBalances.set(t.id, roundMoney(runningAfter(i + 1))));

    const intervals: CheckInterval[] = [];
    for (let i = 1; i < sortedChecks.length; i++) {
        const from = sortedChecks[i - 1], to = sortedChecks[i];
        const expected = from.balance + prefix[checkCounts[i]] - prefix[checkCounts[i - 1]];
        intervals.push({
            from, to,
            expected: roundMoney(expected),
            difference: roundMoney(to.balance - expected),
            transactionCount: checkCounts[i] - checkCounts[i - 1],
        });
    }

    // Balance at a moment: carried forward from the latest check before it, or worked
    // back from the first check after it
    const balanceAt = (date: Date) => {
        const n = countUpTo(date);
        let previous = -1;
        sortedChecks.forEach((c, k) => {
            if (c.date.getTime() <= date.getTime()) previous = k;
        });
        if (previous >= 0) return roundMoney(forwardFrom(previous, n));
        if (sortedChecks.length > 0) return roundMoney(backwardFrom(0, n));
        return roundMoney(prefix[n]);
    };

    return {
        // Today's balance follows the latest check, the bank's most recent word
        balance: roundMoney(latestIndex >= 0 ? forwardFrom(latestIndex, txns.length) : prefix[txns.length]),
        latestCheck: latestIndex >= 0 ? sortedChecks[latestIndex] : null,
        intervals,
        runningBalances,
        balanceAt,
    };
}

// The most recent stretch between two checks whose transactions don't add up
export function latestMismatch(ledger: Ledger, since?: Date): CheckInterval | null {
    for (let i = ledger.intervals.length - 1; i >= 0; i--) {
        const interval = ledger.intervals[i];
        if (since && interval.to.date < since) return null;
        if (Math.abs(interval.difference) >= CENT) return interval;
    }
    return null;
}
