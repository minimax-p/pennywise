import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";

// Statement import against a real MySQL database (TEST_DATABASE_URL); skipped otherwise.
const {testDatabaseUrl, userId} = vi.hoisted(() => {
    const {randomUUID} = require("node:crypto");
    const url = process.env.TEST_DATABASE_URL;
    if (url) process.env.DATABASE_URL = url;
    return {testDatabaseUrl: url, userId: `test-${randomUUID()}`};
});

vi.mock("@/lib/auth", () => ({currentUser: vi.fn(async () => ({id: userId, firstName: null}))}));
vi.mock("next/navigation", () => ({
    redirect: vi.fn(() => {
        throw new Error("redirected");
    }),
}));

import {Account} from "@prisma/client";
import prisma from "@/lib/prisma";
import {getBalance} from "@/lib/accounts";
import {applyMapping, guessMapping, parseFile, StatementRow} from "@/lib/import/parse";
import {commitImport, planImport, PlanRow} from "@/lib/import/plan";
import {EditTransaction} from "@/app/(dashboard)/_actions/transactions";

function statement(name: string, account: Account): StatementRow[] {
    const parsed = parseFile(readFileSync(`tests/fixtures/${name}`, "utf8"));
    if (parsed.format === "ofx") return parsed.rows;
    return applyMapping(parsed.headers, parsed.records, guessMapping(parsed.headers, parsed.records, account.type)).rows;
}

const byDescription = (rows: PlanRow[], text: string) => {
    const row = rows.find((r) => r.description.includes(text));
    if (!row) throw new Error(`No row for ${text}`);
    return row;
};

async function monthTotals(month: number) {
    const row = await prisma.yearHistory.findUnique({where: {month_year_userId: {userId, month, year: 2026}}});
    return {income: row?.income ?? 0, expense: row?.expense ?? 0};
}

describe.skipIf(!testDatabaseUrl)("statement import", () => {
    let chase: Account, discover: Account, savings: Account, venmo: Account;
    const balanceDate = new Date("2026-09-25T23:59:59.999Z");

    async function account(name: string, type: string, institution: string, knownBalance: number) {
        return prisma.account.create({data: {userId, name, type, institution, knownBalance, knownBalanceDate: balanceDate}});
    }

    beforeAll(async () => {
        chase = await account("Chase checking", "checking", "Chase", 1000);
        discover = await account("Discover it", "credit", "Discover", -300);
        savings = await account("Capital One savings", "savings", "Capital One", 10000);
        venmo = await account("Venmo", "cash", "Venmo", 20);
    });

    afterAll(async () => {
        await prisma.importedRow.deleteMany({where: {account: {userId}}});
        await prisma.transaction.deleteMany({where: {userId}});
        await prisma.account.deleteMany({where: {userId}});
        await prisma.monthHistory.deleteMany({where: {userId}});
        await prisma.yearHistory.deleteMany({where: {userId}});
        await prisma.$disconnect();
    });

    it("imports a Chase statement: income, spending and a card payment as a transfer", async () => {
        const plan = await planImport(userId, chase, statement("chase-checking.csv", chase));

        expect(byDescription(plan, "STARBUCKS")).toMatchObject({status: "new", kind: "expense", category: "Unsorted"});
        expect(byDescription(plan, "PAYROLL")).toMatchObject({status: "new", kind: "income", category: "Salary"});
        expect(byDescription(plan, "DISCOVER E-PAYMENT")).toMatchObject({status: "new", kind: "transfer", transferAccountId: discover.id});
        // Paying someone through Venmo from checking is spending, not a transfer to the Venmo balance
        expect(byDescription(plan, "VENMO PAYMENT")).toMatchObject({status: "new", kind: "expense"});

        expect(await commitImport(userId, chase, plan)).toEqual({created: 4, linked: 0, skipped: 0});
        expect(await getBalance(chase)).toBe(1000 - 4.5 + 2500 - 300 - 40);
        expect(await getBalance(discover)).toBe(0);
        expect(await monthTotals(9)).toEqual({income: 2500, expense: 44.5});
    });

    it("links the Discover side of the payment and fills in an Apple Pay purchase's final amount", async () => {
        const unsorted = await prisma.category.findFirstOrThrow({where: {name: "Restaurants", type: "expense", isUniversal: true}});
        const applePay = await prisma.transaction.create({
            data: {
                userId, amount: 5.5, description: "Blue Bottle Coffee", date: new Date("2026-10-06T08:15:00Z"),
                type: "expense", source: "apple_pay", categoryId: unsorted.id, accountId: discover.id,
            },
        });
        await prisma.monthHistory.create({data: {userId, year: 2026, month: 9, day: 6, income: 0, expense: 5.5}});
        await prisma.yearHistory.update({where: {month_year_userId: {userId, month: 9, year: 2026}}, data: {expense: {increment: 5.5}}});

        const plan = await planImport(userId, discover, statement("discover.csv", discover));
        expect(byDescription(plan, "INTERNET PAYMENT")).toMatchObject({status: "transfer", kind: "transfer", transferAccountId: chase.id});
        expect(byDescription(plan, "TRADER JOE")).toMatchObject({status: "new", kind: "expense", category: "Groceries"});
        expect(byDescription(plan, "SHELL")).toMatchObject({status: "new", category: "Gas"});
        expect(byDescription(plan, "BLUE BOTTLE")).toMatchObject({status: "match", linkTransactionId: applePay.id});

        expect(await commitImport(userId, discover, plan)).toEqual({created: 2, linked: 2, skipped: 0});

        // The tip is now included and the history moved with it
        expect(await prisma.transaction.findUniqueOrThrow({where: {id: applePay.id}}))
            .toMatchObject({amount: 6.75, description: "Blue Bottle Coffee", date: new Date("2026-10-06T00:00:00Z")});
        expect(await monthTotals(9)).toEqual({income: 2500, expense: 44.5 + 54.21 + 6.75 + 45.1});
        expect(await getBalance(discover)).toBe(-(54.21 + 6.75 + 45.1));

        const payment = await prisma.transaction.findFirstOrThrow({where: {userId, type: "transfer"}, include: {importedRows: true}});
        expect(payment.importedRows.map((r) => r.accountId).sort()).toEqual([chase.id, discover.id].sort());
    });

    it("skips lines imported before, from the same file or the bank's QFX download", async () => {
        const again = await planImport(userId, chase, statement("chase-checking.csv", chase));
        expect(again.every((r) => r.status === "duplicate" && !r.include)).toBe(true);

        const qfx = await planImport(userId, chase, statement("chase.qfx", chase));
        expect(qfx.map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
        expect(await commitImport(userId, chase, again)).toEqual({created: 0, linked: 0, skipped: 4});
    });

    it("records savings deposits from checking as transfers and interest as income", async () => {
        const plan = await planImport(userId, savings, statement("capital-one-360.csv", savings));
        expect(byDescription(plan, "Deposit from JPMORGAN CHASE")).toMatchObject({status: "new", kind: "transfer", transferAccountId: chase.id});
        expect(byDescription(plan, "Interest")).toMatchObject({kind: "income", category: "Dividends & Interest"});
        await commitImport(userId, savings, plan);

        expect(await getBalance(savings)).toBe(10000 + 500 + 12.34);
        expect(await getBalance(chase)).toBe(1000 - 4.5 + 2500 - 300 - 40 - 500);
    });

    it("turns a matching expense in another account into a transfer", async () => {
        const general = await prisma.category.findFirstOrThrow({where: {name: "General", type: "expense", isUniversal: true}});
        const expense = await prisma.transaction.create({
            data: {
                userId, amount: 200, description: "CAPITAL ONE ONLINE TRANSFER", date: new Date("2026-10-10T00:00:00Z"),
                type: "expense", source: "import", categoryId: general.id, accountId: chase.id,
            },
        });
        const rows: StatementRow[] = [{
            date: new Date("2026-10-11T00:00:00Z"), amount: 200, description: "Deposit from JPMORGAN CHASE BANK",
            externalId: null, bankCategory: null, skipReason: null,
        }];
        const [row] = await planImport(userId, savings, rows);
        expect(row).toMatchObject({status: "pair", linkTransactionId: expense.id, transferAccountId: chase.id});

        await commitImport(userId, savings, [row]);
        expect(await prisma.transaction.findUniqueOrThrow({where: {id: expense.id}}))
            .toMatchObject({type: "transfer", accountId: chase.id, toAccountId: savings.id});
    });

    it("learns categories from your edits", async () => {
        const starbucks = await prisma.transaction.findFirstOrThrow({where: {userId, description: {contains: "STARBUCKS"}}});
        await EditTransaction({
            id: starbucks.id, type: "expense", amount: 4.5, date: starbucks.date, category: "Coffee Shops",
            accountId: chase.id, description: "Morning coffee",
        });
        const [row] = await planImport(userId, chase, [{
            date: new Date("2026-10-20T00:00:00Z"), amount: -5.25, description: "STARBUCKS STORE 678 BELLEVUE WA",
            externalId: null, bankCategory: null, skipReason: null,
        }]);
        expect(row).toMatchObject({status: "new", category: "Coffee Shops"});
    });

    it("imports Venmo, leaving out payments funded from a bank card", async () => {
        const plan = await planImport(userId, venmo, statement("venmo.csv", venmo));
        expect(plan.map((r) => [r.description, r.status, r.include])).toEqual([
            ["Jane Seller: couch", "skip", false],
            ["Sam Friend: pizza split", "new", true],
            ["Sam Friend: tacos", "new", true],
        ]);
        expect(await commitImport(userId, venmo, plan)).toEqual({created: 2, linked: 0, skipped: 1});
        expect(await getBalance(venmo)).toBe(20 + 15 - 12);
    });
});
