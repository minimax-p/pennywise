import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";

// Account balances and transfers against a real MySQL database (TEST_DATABASE_URL); skipped otherwise.
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
import {getBalance} from "@/lib/accounts";
import {CreateAccount, DeleteAccount, SetAccountBalance} from "@/app/(dashboard)/_actions/accounts";
import {CreateTransaction, CreateTransfer, DeleteTransaction, EditTransaction} from "@/app/(dashboard)/_actions/transactions";

const userIds = [userId, otherUserId];

async function cleanUp() {
    await prisma.transaction.deleteMany({where: {userId: {in: userIds}}});
    await prisma.account.deleteMany({where: {userId: {in: userIds}}});
    await prisma.monthHistory.deleteMany({where: {userId: {in: userIds}}});
    await prisma.yearHistory.deleteMany({where: {userId: {in: userIds}}});
}

async function created(promise: ReturnType<typeof CreateAccount>) {
    const result = await promise;
    if (!result.ok) throw new Error(result.error);
    return result.data;
}

async function balanceOf(id: string) {
    return getBalance(await prisma.account.findUniqueOrThrow({where: {id}}));
}

async function monthExpense(month: number) {
    const row = await prisma.yearHistory.findUnique({where: {month_year_userId: {userId, month, year: 2026}}});
    return {income: row?.income ?? 0, expense: row?.expense ?? 0};
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
        await CreateTransaction({amount: 2000, category: "Salary", type: "income", date: sept(15), accountId: chase.id});
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

        await SetAccountBalance({id: chase.id, balance: 300, balanceDate: new Date("2026-09-30T23:59:59.999Z")});
        expect(await balanceOf(chase.id)).toBe(300);
    });

    it("converts between expense and transfer, keeping history totals right", async () => {
        const chase = await created(CreateAccount({name: "Chase checking", type: "checking", balance: 1000, balanceDate}));
        const discover = await created(CreateAccount({name: "Discover", type: "credit", balance: -300, balanceDate}));

        // Recorded as an expense by mistake, e.g. from a statement import
        await CreateTransaction({amount: 300, category: "General", type: "expense", date: sept(10), accountId: chase.id, description: "DISCOVER E-PAYMENT"});
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
