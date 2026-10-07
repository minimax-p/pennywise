import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";

// Statement balances, Zelle to yourself and Home against a real MySQL database
// (TEST_DATABASE_URL); skipped otherwise.
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
import {getBalance, loadLedger} from "@/lib/accounts";
import {getTotals} from "@/lib/reports";
import {getHome} from "@/lib/home";
import {getAccountPage} from "@/lib/accountPage";
import {applyMapping, guessMapping, parseFile, statementBalances} from "@/lib/import/parse";
import {commitImport, planImport, PlanRow} from "@/lib/import/plan";
import {ConvertSelfZelle, UpdateSelfNames} from "@/app/(dashboard)/_actions/settings";

function chaseStatement() {
    const parsed = parseFile(readFileSync("tests/fixtures/chase-checking-balances.csv", "utf8"));
    if (parsed.format !== "csv") throw new Error("expected csv");
    const rows = applyMapping(parsed.headers, parsed.records, guessMapping(parsed.headers, parsed.records, "checking")).rows;
    return {rows, balances: statementBalances(rows)};
}

const byDescription = (rows: PlanRow[], text: string) => {
    const row = rows.find((r) => r.description.includes(text));
    if (!row) throw new Error(`No row for ${text}`);
    return row;
};

describe.skipIf(!testDatabaseUrl)("statement balances", () => {
    let chase: Account, savings: Account;

    async function cleanUp() {
        await prisma.importedRow.deleteMany({where: {account: {userId}}});
        await prisma.transaction.deleteMany({where: {userId}});
        await prisma.account.deleteMany({where: {userId}});
        await prisma.userSettings.deleteMany({where: {userId}});
    }

    beforeEach(async () => {
        await cleanUp();
        chase = await prisma.account.create({data: {userId, name: "Chase checking", type: "checking", institution: "Chase"}});
        savings = await prisma.account.create({
            data: {
                userId, name: "Capital One savings", type: "savings", institution: "Capital One",
                balanceChecks: {create: {date: new Date("2026-09-01T23:59:59.999Z"), balance: 5000, source: "you"}},
            },
        });
        await prisma.account.create({data: {userId, name: "Discover", type: "credit", institution: "Discover"}});
        // A CD can't receive Zelle, so it doesn't make the other end ambiguous
        await prisma.account.create({data: {userId, name: "CD", type: "cd", institution: "Capital One"}});
        expect(await UpdateSelfNames("Test User")).toEqual({ok: true, data: "Test User"});
    });

    afterAll(async () => {
        await cleanUp();
        await prisma.$disconnect();
    });

    it("imports Zelle to yourself as transfers and saves the statement's balances", async () => {
        const {rows, balances} = chaseStatement();
        const plan = await planImport(userId, chase, rows);
        expect(byDescription(plan, "Zelle payment to TEST USER")).toMatchObject({kind: "transfer", transferAccountId: savings.id});
        // Money received names the sending bank in its code
        expect(byDescription(plan, "Zelle payment from TEST USER")).toMatchObject({kind: "transfer", transferAccountId: savings.id});
        expect(byDescription(plan, "ALEX FRIEND")).toMatchObject({kind: "income"});

        const result = await commitImport(userId, chase, plan, balances);
        expect(result).toEqual({
            created: 6, linked: 0, skipped: 0,
            statement: {checks: 6, lastDate: "2026-10-05T23:59:59.999Z", lastBalance: 1451.58, mismatches: 0, latestMismatch: null},
        });
        expect(await getBalance(chase)).toBe(1451.58);
        expect(await getBalance(savings)).toBe(5000 - 100 + 200);

        // Running balances read exactly like the statement's Balance column, in the bank's order
        const ledger = await loadLedger(chase.id);
        const transactions = await prisma.transaction.findMany({where: {userId, OR: [{accountId: chase.id}, {toAccountId: chase.id}]}});
        const running = Object.fromEntries(transactions.map((t) => [t.description.slice(0, 20), ledger.runningBalances.get(t.id)]));
        expect(running).toEqual({
            "Zelle payment to TES": 1451.58,
            "TST*TEA SHOP MIDDLET": 1651.58,
            "Zelle payment from T": 1660.23,
            "Zelle payment from A": 1560.23,
            "WAL-MART #2131 MIDDL": 1530.23,
            "ACME INC PAYROLL    ": 1586.08,
        });

        // Moving money to yourself is neither spending nor income
        expect(await getTotals(userId, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-31T23:59:59Z")))
            .toEqual({spending: 64.5, income: 30});

        // Importing the same file again changes nothing and doesn't duplicate the balances
        const again = await planImport(userId, chase, rows);
        expect(again.every((r) => r.status === "duplicate")).toBe(true);
        expect((await commitImport(userId, chase, again, balances)).statement).toMatchObject({checks: 6, mismatches: 0});
        expect(await prisma.balanceCheck.count({where: {accountId: chase.id}})).toBe(6);
    });

    it("points at the day where the transactions don't add up to the statement", async () => {
        const {rows, balances} = chaseStatement();
        const plan = (await planImport(userId, chase, rows))
            .map((r) => r.description.startsWith("WAL-MART") ? {...r, include: false} : r);
        const result = await commitImport(userId, chase, plan, balances);
        expect(result.statement).toMatchObject({
            mismatches: 1,
            latestMismatch: {from: "2026-09-30T23:59:59.999Z", to: "2026-10-01T23:59:59.999Z", difference: -55.85, transactionCount: 0},
        });
        // The balance still follows the bank
        expect(await getBalance(chase)).toBe(1451.58);

        const page = await getAccountPage(userId, chase.id, 0);
        expect(page?.account.check.mismatch).toMatchObject({difference: -55.85});
        expect(page?.statements).toMatchObject({count: 6});
        expect(page?.mismatches).toHaveLength(1);
    });

    it("leaves Zelle to yourself for you to place when it could be more than one account", async () => {
        await prisma.account.create({data: {userId, name: "Ally savings", type: "savings", institution: "Ally"}});
        const plan = await planImport(userId, chase, chaseStatement().rows);
        expect(byDescription(plan, "Zelle payment to TEST USER")).toMatchObject({kind: "transfer", transferAccountId: null});
        // The sending bank's code still settles money received
        expect(byDescription(plan, "Zelle payment from TEST USER")).toMatchObject({transferAccountId: savings.id});
    });

    it("turns Zelle to yourself imported before your name was set into transfers", async () => {
        await UpdateSelfNames("");
        const {rows, balances} = chaseStatement();
        await commitImport(userId, chase, await planImport(userId, chase, rows), balances);
        const october = () => getTotals(userId, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-31T23:59:59Z"));
        // Counted as spending and income while your name was missing
        expect(await october()).toEqual({spending: 264.5, income: 130});
        expect(await ConvertSelfZelle(true)).toEqual({ok: false, error: "Add your name first"});

        await UpdateSelfNames("Test User");
        expect(await ConvertSelfZelle(true)).toEqual({ok: true, data: {converted: 2, skipped: 0}});
        expect(await october()).toEqual({spending: 264.5, income: 130});
        expect(await ConvertSelfZelle(false)).toEqual({ok: true, data: {converted: 2, skipped: 0}});
        expect(await october()).toEqual({spending: 64.5, income: 30});
        expect(await getBalance(chase)).toBe(1451.58);
        expect(await getBalance(savings)).toBe(5000 - 100 + 200);
        expect(await ConvertSelfZelle(true)).toEqual({ok: true, data: {converted: 0, skipped: 0}});
    });

    it("shows spending money, savings and this month on Home", async () => {
        const {rows, balances} = chaseStatement();
        await commitImport(userId, chase, await planImport(userId, chase, rows), balances);
        const home = await getHome(userId, new Date(2026, 9, 7, 12));

        expect(home.totals).toEqual({spendingMoney: 1451.58, savings: 5100, netWorth: 6551.58});
        expect(home.spendingParts.map((p) => [p.name, p.balance])).toEqual([["Chase checking", 1451.58], ["Discover", 0]]);
        expect(home.groups.map((g) => [g.id, g.total])).toEqual([["spending", 1451.58], ["credit", 0], ["savings", 5100]]);
        expect(home.month).toMatchObject({spent: 64.5, income: 30, lastMonthSoFar: 0, daysInMonth: 31});
        expect(home.month.pace.map((p) => p.total)).toEqual([55.85, 55.85, 55.85, 55.85, 64.5, 64.5, 64.5]);
        expect(home.recent[0]).toMatchObject({description: "Zelle payment to TEST USER JPM99abc123", type: "transfer"});
        // Chase was just checked by the statement; savings' only check is a month old
        expect(home.staleAccounts.map((a) => a.name)).toEqual(["Capital One savings"]);
    });
});
