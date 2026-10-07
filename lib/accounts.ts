import {Prisma} from "@prisma/client";
import prisma from "@/lib/prisma";
import {buildLedger, CheckInterval, latestMismatch, Ledger, LedgerCheck, LedgerTransaction} from "@/lib/ledger";
import {AccountType} from "@/lib/types";

const ledgerTransactionFields = {
    id: true, date: true, createdAt: true, type: true, amount: true, accountId: true, toAccountId: true,
} satisfies Prisma.TransactionSelect;

const ledgerCheckFields = {
    id: true, accountId: true, date: true, createdAt: true, balance: true, source: true,
} satisfies Prisma.BalanceCheckSelect;

export async function loadLedger(accountId: string, db: Prisma.TransactionClient = prisma): Promise<Ledger> {
    const [transactions, checks] = await Promise.all([
        db.transaction.findMany({where: {OR: [{accountId}, {toAccountId: accountId}]}, select: ledgerTransactionFields}),
        db.balanceCheck.findMany({where: {accountId}, select: ledgerCheckFields}),
    ]);
    return buildLedger(accountId, transactions, checks);
}

// Ledgers for several accounts with two queries
export async function loadLedgers(userId: string, accountIds: string[]): Promise<Map<string, Ledger>> {
    if (accountIds.length === 0) return new Map();
    const [transactions, checks] = await Promise.all([
        prisma.transaction.findMany({
            where: {userId, OR: [{accountId: {in: accountIds}}, {toAccountId: {in: accountIds}}]},
            select: ledgerTransactionFields,
        }),
        prisma.balanceCheck.findMany({where: {accountId: {in: accountIds}}, select: ledgerCheckFields}),
    ]);
    const checksByAccount = new Map<string, LedgerCheck[]>();
    for (const check of checks) {
        checksByAccount.set(check.accountId, [...(checksByAccount.get(check.accountId) ?? []), check]);
    }
    return new Map(accountIds.map((id) => [
        id,
        buildLedger(id, transactions as LedgerTransaction[], checksByAccount.get(id) ?? []),
    ]));
}

export async function getBalance(account: { id: string }): Promise<number> {
    return (await loadLedger(account.id)).balance;
}

// Mismatches older than this stop being flagged on Home
const MISMATCH_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CheckStatus = {
    // When the bank's balance was last compared, and whether you typed it or a statement had it
    lastCheckedAt: string | null;
    lastCheckSource: string | null;
    daysSinceCheck: number | null;
    // The latest stretch in the last 90 days where transactions don't add up to the bank's balances
    mismatch: { from: string, to: string, difference: number, transactionCount: number } | null;
};

export function intervalSummary(interval: CheckInterval) {
    return {
        from: interval.from.date.toISOString(),
        to: interval.to.date.toISOString(),
        difference: interval.difference,
        transactionCount: interval.transactionCount,
    };
}

export function checkStatus(ledger: Ledger, now = new Date()): CheckStatus {
    const latest = ledger.latestCheck;
    const mismatch = latestMismatch(ledger, new Date(now.getTime() - MISMATCH_WINDOW_DAYS * DAY_MS));
    return {
        lastCheckedAt: latest?.date.toISOString() ?? null,
        lastCheckSource: latest?.source ?? null,
        daysSinceCheck: latest ? Math.max(0, Math.floor((now.getTime() - latest.date.getTime()) / DAY_MS)) : null,
        mismatch: mismatch ? intervalSummary(mismatch) : null,
    };
}

// How accounts are grouped on Home
export const ACCOUNT_GROUPS = [
    {id: "spending", label: "Cash & checking", types: ["checking", "cash"]},
    {id: "credit", label: "Credit cards", types: ["credit"]},
    {id: "savings", label: "Savings & CDs", types: ["savings", "cd"]},
] as const satisfies readonly { id: string, label: string, types: readonly AccountType[] }[];

export type AccountGroupId = typeof ACCOUNT_GROUPS[number]["id"];

export function accountGroup(type: string): AccountGroupId {
    return ACCOUNT_GROUPS.find((g) => (g.types as readonly string[]).includes(type))?.id ?? "spending";
}

// Every account with its balance, group and how it compares with the bank
export async function listAccounts(userId: string, now = new Date()) {
    const accounts = await prisma.account.findMany({
        where: {userId},
        orderBy: [{archived: 'asc'}, {createdAt: 'asc'}],
        select: {
            id: true,
            name: true,
            type: true,
            institution: true,
            walletCardName: true,
            apy: true,
            maturesOn: true,
            archived: true,
            createdAt: true,
            _count: {select: {transactions: true, incomingTransfers: true}},
        },
    });
    const ledgers = await loadLedgers(userId, accounts.map((a) => a.id));

    return accounts.map(({_count, ...account}) => {
        const ledger = ledgers.get(account.id)!;
        return {
            ...account,
            group: accountGroup(account.type),
            balance: ledger.balance,
            check: checkStatus(ledger, now),
            transactionCount: _count.transactions + _count.incomingTransfers,
        };
    });
}

export type AccountSummary = Awaited<ReturnType<typeof listAccounts>>[number];

// Universal category that every transfer is filed under
export async function getTransferCategory(db: Prisma.TransactionClient = prisma) {
    const existing = await db.category.findFirst({where: {type: "transfer", isUniversal: true}});
    return existing ?? db.category.create({
        data: {name: "Transfer", icon: "🔁", type: "transfer", isUniversal: true},
    });
}

// Universal category for balance adjustments, which are neither spending nor income
export async function getAdjustmentCategory(db: Prisma.TransactionClient = prisma) {
    const existing = await db.category.findFirst({where: {type: "adjustment", isUniversal: true}});
    return existing ?? db.category.create({
        data: {name: "Adjustment", icon: "⚖️", type: "adjustment", isUniversal: true},
    });
}

// Throws unless every id is an account owned by the user
export async function assertOwnAccounts(userId: string, ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return;
    const found = await prisma.account.count({where: {userId, id: {in: wanted}}});
    if (found !== wanted.length) {
        throw new Error("Account not found");
    }
}
