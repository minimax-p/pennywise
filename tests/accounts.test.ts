import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";

// Account balances and transfers against a real PostgreSQL database (TEST_DATABASE_URL); skipped otherwise.
const {testDatabaseUrl, userId, otherUserId} = vi.hoisted(() => {
    const {randomUUID} = require("node:crypto");
    const url = process.env.TEST_DATABASE_URL;
    if (url) process.env.DATABASE_URL = url;
    return {testDatabaseUrl: url, userId: `test-${randomUUID()}`, otherUserId: `test-${randomUUID()}`};
});

vi.mock("@/lib/auth", () => ({currentUser: vi.fn(async () => ({id: userId, firstName: null}))}));
vi.mock("next/navigation", () => ({
    redirect: vi.fn(() => {
        throw new Error("redirected");
    }),
}));

import prisma from "@/lib/prisma";
import {getBalance, loadLedger} from "@/lib/accounts";
import {getTotals} from "@/lib/reports";
import {CheckBalance, CreateAccount, DeleteAccount, DeleteBalanceCheck, EditAccount} from "@/app/(dashboard)/_actions/accounts";
import {CreateTransaction, CreateTransfer, DeleteTransaction, EditTransaction} from "@/app/(dashboard)/_actions/transactions";

const userIds = [userId, otherUserId];

async function cleanUp() {
    await prisma.transaction.deleteMany({where: {userId: {in: userIds}}});
    await prisma.account.deleteMany({where: {userId: {in: userIds}}});
}

async function created(promise: ReturnType<typeof CreateAccount>) {
    const result = await promise;
    if (!result.ok) throw new Error(result.error);
    return result.data;
}

async function balanceOf(id: string) {
    return getBalance(await prisma.account.findUniqueOrThrow({where: {id}}));
}

// Spending and income in a month of 2026 (0 = January)
async function monthExpense(month: number) {
    const {spending, income} = await getTotals(userId, new Date(Date.UTC(2026, month, 1)), new Date(Date.UTC(2026, month + 1, 1) - 1));
    return {income, expense: spending};
}

async function checked(promise: ReturnType<typeof CheckBalance>) {
    const result = await promise;
    if (!result.ok) throw new Error(result.error);
    return result.data;
}

describe.skipIf(!testDatabaseUrl)("accounts and transfers", () => {
    beforeEach(cleanUp);
    afterAll(async () => {
        await cleanUp();
        await prisma.$disconnect();
    });

    const balanceDate = new Date("2026-09-01T23:59:59.999Z");
    const sept = (day: number) => new Date(Date.UTC(2026, 8, day));

    it("tracks balances per account, with transfers moving money but not counting as spending", async () => {
        const chase = await created(CreateAccount({name: "Chase checking", type: "checking", institution: "Chase", balance: 1000, balanceDate}));
        const discover = await created(CreateAccount({name: "Discover", type: "credit", institution: "Discover", balance: -200, balanceDate}));

        await CreateTransaction({amount: 50, category: "Groceries", type: "expense", date: sept(5), accountId: discover.id, description: "Market"});
        await CreateTransaction({amount: 2000, category: "Paycheck", type: "income", date: sept(15), accountId: chase.id});
        await CreateTransfer({amount: 250, date: sept(20), fromAccountId: chase.id, toAccountId: discover.id, description: "Card payment"});

        expect(await balanceOf(chase.id)).toBe(1000 + 2000 - 250);
        expect(await balanceOf(discover.id)).toBe(-200 - 50 + 250);
        expect(await monthExpense(8)).toEqual({income: 2000, expense: 50});

        const transfer = await prisma.transaction.findFirstOrThrow({where: {userId, type: "transfer"}, include: {category: true}});
        expect(transfer).toMatchObject({accountId: chase.id, toAccountId: discover.id, category: {name: "Transfer"}});
    });

    it("ignores transactions dated on or before the entered balance", async () => {
        const chase = await created(CreateAccount({name: "Chase checking", type: "checking", balance: 500, balanceDate}));
        await CreateTransaction({amount: 40, category: "Groceries", type: "expense", date: new Date("2026-08-28T00:00:00Z"), accountId: chase.id});
        await CreateTransaction({amount: 10, category: "Groceries", type: "expense", date: new Date("2026-09-01T00:00:00Z"), accountId: chase.id});
        expect(await balanceOf(chase.id)).toBe(500);

        await CreateTransaction({amount: 25, category: "Groceries", type: "expense", date: sept(2), accountId: chase.id});
        expect(await balanceOf(chase.id)).toBe(475);

        await checked(CheckBalance({accountId: chase.id, balance: 300, balanceDate: new Date("2026-09-30T23:59:59.999Z"), save: true}));
        expect(await balanceOf(chase.id)).toBe(300);
    });

    it("compares a balance check with the transactions before saving it", async () => {
        const chase = await created(CreateAccount({name: "Chase checking", type: "checking", balance: 500, balanceDate}));
        await CreateTransaction({amount: 25, category: "Groceries", type: "expense", date: sept(2), accountId: chase.id});
        await CreateTransaction({amount: 100, category: "Paycheck", type: "income", date: sept(3), accountId: chase.id});
        const sept5 = new Date("2026-09-05T23:59:59.999Z");

        // Matches: 500 - 25 + 100
        expect(await checked(CheckBalance({accountId: chase.id, balance: 575, balanceDate: sept5, save: false})))
            .toEqual({expected: 575, difference: 0, previousCheckAt: balanceDate.toISOString(), transactionsSince: 2, saved: false});

        // The bank has 12.34 less: saved without an adjustment, the bank's number wins and the stretch is flagged
        const preview = await checked(CheckBalance({accountId: chase.id, balance: 562.66, balanceDate: sept5, save: true}));
        expect(preview).toMatchObject({expected: 575, difference: -12.34, saved: true});
        expect(await balanceOf(chase.id)).toBe(562.66);
        let ledger = await loadLedger(chase.id);
        expect(ledger.intervals.map((i) => i.difference)).toEqual([-12.34]);

        // Checking again with an adjustment makes the transactions add up
        const check = await prisma.balanceCheck.findFirstOrThrow({where: {accountId: chase.id, balance: 562.66}});
        expect(await DeleteBalanceCheck({id: check.id})).toEqual({ok: true, data: null});
        await checked(CheckBalance({accountId: chase.id, balance: 562.66, balanceDate: sept5, save: true, adjust: true}));
        ledger = await loadLedger(chase.id);
        expect(ledger.intervals.map((i) => i.difference)).toEqual([0]);
        expect(ledger.balance).toBe(562.66);
        const adjustment = await prisma.transaction.findFirstOrThrow({where: {userId, type: "adjustment"}, include: {category: true}});
        expect(adjustment).toMatchObject({amount: 12.34, accountId: chase.id, toAccountId: null, category: {name: "Adjustment"}});
        // Adjustments are neither spending nor income
        expect(await monthExpense(8)).toEqual({income: 100, expense: 25});
    });

    it("uses the latest of several checks with nothing in between", async () => {
        const savings = await created(CreateAccount({name: "Savings", type: "savings", balance: 1000, balanceDate}));
        const later = new Date("2026-09-02T23:59:59.999Z");
        await checked(CheckBalance({accountId: savings.id, balance: 1003.5, balanceDate: later, save: true}));
        expect(await balanceOf(savings.id)).toBe(1003.5);
    });

    it("keeps CD details only on CDs", async () => {
        const cd = await created(CreateAccount({
            name: "12-month CD", type: "cd", institution: "Capital One", balance: 10000, balanceDate,
            apy: 4.1, maturesOn: new Date("2027-03-01T00:00:00Z"),
        }));
        expect(cd).toMatchObject({apy: 4.1, maturesOn: new Date("2027-03-01T00:00:00Z")});
        const edited = await EditAccount({id: cd.id, name: "Savings", type: "savings", archived: false, apy: 4.1});
        expect(edited.ok && edited.data).toMatchObject({apy: null, maturesOn: null});
    });

    it("counts money back in a spending category as less spending", async () => {
        const discover = await created(CreateAccount({name: "Discover", type: "credit", balance: 0, balanceDate}));
        await CreateTransaction({amount: 80, category: "Groceries", type: "expense", date: sept(4), accountId: discover.id});
        await CreateTransaction({amount: 30, category: "Groceries", categoryType: "expense", type: "income", date: sept(6), accountId: discover.id, note: "returned eggs"});
        expect(await monthExpense(8)).toEqual({income: 0, expense: 50});
        expect(await balanceOf(discover.id)).toBe(-50);
        const refund = await prisma.transaction.findFirstOrThrow({where: {userId, type: "income"}, include: {category: true}});
        expect(refund).toMatchObject({note: "returned eggs", category: {name: "Groceries", type: "expense"}});
    });

    it("converts between expense and transfer, keeping history totals right", async () => {
        const chase = await created(CreateAccount({name: "Chase checking", type: "checking", balance: 1000, balanceDate}));
        const discover = await created(CreateAccount({name: "Discover", type: "credit", balance: -300, balanceDate}));

        // Recorded as an expense by mistake, e.g. from a statement import
        await CreateTransaction({amount: 300, category: "Shopping", type: "expense", date: sept(10), accountId: chase.id, description: "DISCOVER E-PAYMENT"});
        const payment = await prisma.transaction.findFirstOrThrow({where: {userId}});
        expect(await monthExpense(8)).toEqual({income: 0, expense: 300});

        await EditTransaction({
            id: payment.id, type: "transfer", amount: 300, date: sept(10),
            accountId: chase.id, toAccountId: discover.id, description: "Card payment",
        });
        expect(await monthExpense(8)).toEqual({income: 0, expense: 0});
        expect(await balanceOf(chase.id)).toBe(700);
        expect(await balanceOf(discover.id)).toBe(0);

        await DeleteTransaction({id: payment.id});
        expect(await balanceOf(chase.id)).toBe(1000);
        expect(await balanceOf(discover.id)).toBe(-300);
    });

    it("rejects other users' accounts and transfers to the same account", async () => {
        const mine = await created(CreateAccount({name: "Chase checking", type: "checking", balance: 0, balanceDate}));
        const theirs = await prisma.account.create({data: {userId: otherUserId, name: "Theirs", type: "checking"}});
        const theirCheck = await prisma.balanceCheck.create({data: {accountId: theirs.id, date: balanceDate, balance: 1, source: "you"}});
        expect(await DeleteBalanceCheck({id: theirCheck.id})).toEqual({ok: false, error: "Balance check not found"});
        expect(await CheckBalance({accountId: theirs.id, balance: 1, balanceDate, save: true}))
            .toEqual({ok: false, error: "Account not found"});

        await expect(CreateTransaction({amount: 5, category: "Groceries", type: "expense", date: sept(1), accountId: theirs.id}))
            .rejects.toThrow("Account not found");
        await expect(CreateTransfer({amount: 5, date: sept(1), fromAccountId: mine.id, toAccountId: theirs.id}))
            .rejects.toThrow("Account not found");
        await expect(CreateTransfer({amount: 5, date: sept(1), fromAccountId: mine.id, toAccountId: mine.id}))
            .rejects.toThrow();
        expect(await CreateAccount({name: "Chase checking", type: "savings", balance: 0, balanceDate}))
            .toEqual({ok: false, error: 'An account named "Chase checking" already exists'});
    });

    it("only deletes accounts without transactions", async () => {
        const used = await created(CreateAccount({name: "Chase checking", type: "checking", balance: 0, balanceDate}));
        const empty = await created(CreateAccount({name: "Old card", type: "credit", balance: 0, balanceDate}));
        await CreateTransaction({amount: 5, category: "Groceries", type: "expense", date: sept(1), accountId: used.id});

        expect(await DeleteAccount({id: used.id})).toEqual({ok: false, error: "This account has transactions. Archive it instead."});
        expect(await DeleteAccount({id: empty.id})).toEqual({ok: true, data: null});
        expect(await prisma.account.count({where: {userId}})).toBe(1);
    });
});
