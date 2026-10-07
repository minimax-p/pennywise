import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";

// Rules, merchant names and the Sort deck against a real PostgreSQL database
// (TEST_DATABASE_URL); the pure parts run without one.
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
import {cleanMerchant, merchantName, nameFields} from "@/lib/merchant";
import {LoadedRule, matchRule} from "@/lib/rules";
import {getBalance} from "@/lib/accounts";
import {getAutoSorted, getSortQueue} from "@/lib/sortQueue";
import {StatementRow} from "@/lib/import/parse";
import {commitImport, planImport} from "@/lib/import/plan";
import {MakeTransfer, MarkPaidBack, ReturnToSort, SortGroup, UndoSort} from "@/app/(dashboard)/_actions/review";
import {DeleteRule, SaveRule} from "@/app/(dashboard)/_actions/rules";
import {SaveEntry} from "@/app/(dashboard)/_actions/transactions";

describe("merchant names", () => {
    it("cleans up bank lines", () => {
        expect(cleanMerchant("WAL-MART #2131    MIDDLETOWN NY")).toBe("Walmart");
        expect(cleanMerchant("SQ *BLUE BOTTLE COFFEE 0412 OAKLAND CA")).toBe("Blue Bottle Coffee");
        expect(cleanMerchant("TST*TEA SHOP        MIDDLETOWN NY 10940")).toBe("Tea Shop");
        expect(cleanMerchant("Zelle payment to DANA PARK JPM99abc")).toBe("Zelle to Dana Park");
        expect(cleanMerchant("UBER   *EATS PENDING")).toBe("Uber Eats");
        expect(cleanMerchant("ATM WITHDRAWAL                 10/05 ROUTE 17")).toBe("ATM Withdrawal");
        expect(cleanMerchant("PURCHASE AUTHORIZED ON 10/02 SHELL OIL 57444 NEW YORK NY")).toBe("Shell");
        expect(cleanMerchant("Online Transfer to SAV ...1234 transaction#: 123")).toBe("Online Transfer to SAV");
        expect(cleanMerchant("Sam Friend")).toBe("Sam Friend");
    });

    it("shows your own name for a line and keeps the bank's text", () => {
        const line = {description: "ACME DEPOT #2131    MIDDLETOWN NY", merchant: null, source: "import"};
        expect(merchantName(line)).toBe("Acme Depot");
        expect(merchantName({...line, merchant: "Walmart Supercenter"})).toBe("Walmart Supercenter");
        expect(merchantName({...line, source: "manual", description: "walmart run"})).toBe("walmart run");
        expect(nameFields(line, "Acme Depot")).toEqual({description: line.description, merchant: null});
        expect(nameFields(line, "Groceries at Walmart")).toEqual({description: line.description, merchant: "Groceries at Walmart"});
        expect(nameFields({...line, source: "manual"}, "Costco")).toEqual({description: "Costco", merchant: null});
        expect(nameFields(null, " Costco ")).toEqual({description: "Costco", merchant: null});
    });
});

describe("matching rules", () => {
    const rule = (fields: Partial<LoadedRule>): LoadedRule => ({
        id: fields.kind ?? "r", userId: "u", kind: "contains", pattern: null, personId: null, direction: null, categoryId: null,
        rename: null, label: "", createdAt: new Date(), updatedAt: new Date(), person: null, category: null, ...fields,
    });
    const rules = [
        rule({id: "contains", kind: "contains", pattern: "zelle"}),
        rule({id: "longer", kind: "contains", pattern: "zelle payment to"}),
        rule({id: "merchant", kind: "merchant", pattern: "WAL MART", direction: "expense"}),
        rule({id: "person", kind: "person", personId: "dana", person: {id: "dana", name: "Dana Park", aliases: ["DANA PARK"]}}),
    ];

    it("prefers people, then merchants, then the longest text", () => {
        expect(matchRule(rules, {description: "Zelle payment to DANA PARK JPM99", type: "expense", person: "DANA PARK"})?.id).toBe("person");
        expect(matchRule(rules, {description: "Zelle payment to SAM JPM99", type: "expense"})?.id).toBe("longer");
        expect(matchRule(rules, {description: "Zelle payment from SAM JPM99", type: "income"})?.id).toBe("contains");
        expect(matchRule(rules, {description: "WAL-MART #2131 MIDDLETOWN NY", type: "expense"})?.id).toBe("merchant");
        // Only money going out
        expect(matchRule(rules, {description: "WAL-MART REFUND", type: "income"})).toBeNull();
        expect(matchRule(rules, {description: "anything", type: "income", personId: "dana"})?.id).toBe("person");
    });
});

const line = (description: string, amount: number, d: number): StatementRow =>
    ({date: new Date(Date.UTC(2026, 9, d)), amount, description, externalId: null, bankCategory: null, skipReason: null});

describe.skipIf(!testDatabaseUrl)("sorting with rules", () => {
    let chase: Account, cash: Account;

    async function cleanUp() {
        await prisma.importedRow.deleteMany({where: {account: {userId}}});
        await prisma.transaction.deleteMany({where: {userId}});
        await prisma.rule.deleteMany({where: {userId}});
        await prisma.person.deleteMany({where: {userId}});
        await prisma.account.deleteMany({where: {userId}});
        await prisma.userSettings.deleteMany({where: {userId}});
    }

    beforeEach(async () => {
        await cleanUp();
        const balanceChecks = (balance: number) => ({create: {date: new Date("2026-09-30T23:59:59.999Z"), balance, source: "you"}});
        chase = await prisma.account.create({data: {userId, name: "Chase checking", type: "checking", institution: "Chase", balanceChecks: balanceChecks(1000)}});
        cash = await prisma.account.create({data: {userId, name: "Cash", type: "cash", balanceChecks: balanceChecks(20)}});
    });

    afterAll(async () => {
        await cleanUp();
        await prisma.$disconnect();
    });

    const importLines = async (rows: StatementRow[]) => commitImport(userId, chase, await planImport(userId, chase, rows));

    it("files a merchant's card at once, learns it with Always, and undoes both", async () => {
        await importLines([line("ACME DEPOT #2131    MIDDLETOWN NY", -40, 1), line("ACME DEPOT #2131    MIDDLETOWN NY", -25.5, 3), line("ODD SHOP", -9, 2)]);
        const queue = await getSortQueue(userId);
        const walmart = queue.cards.find((c) => c.name === "Acme Depot")!;
        expect(walmart).toMatchObject({ids: expect.any(Array), total: 65.5, type: "expense", canAlways: true});
        expect(walmart.ids).toHaveLength(2);
        expect(queue.cards).toHaveLength(2);

        const sorted = await SortGroup({ids: walmart.ids, category: "Groceries", always: true});
        if (!sorted.ok) throw new Error(sorted.error);
        expect(sorted.data).toMatchObject({sorted: 2, rule: "Acme Depot"});
        expect((await getSortQueue(userId)).cards.map((c) => c.name)).toEqual(["Odd Shop"]);

        // The next Walmart line is filed by the rule
        await importLines([line("ACME DEPOT #2131    MIDDLETOWN NY", -12, 6)]);
        const next = await prisma.transaction.findFirstOrThrow({where: {userId, amount: 12}, include: {category: true}});
        expect(next).toMatchObject({needsReview: false, categorizedBy: "rule", category: {name: "Groceries"}});
        expect((await getAutoSorted(userId)).map((r) => [r.name, r.categorizedBy])).toEqual([["Acme Depot", "rule"]]);

        // Always again on the same merchant changes the rule instead of adding one
        const lines = await importLines([line("ACME DEPOT #2131    MIDDLETOWN NY", -7, 8)]);
        expect(lines.created).toBe(1);
        const seven = await prisma.transaction.findFirstOrThrow({where: {userId, amount: 7}});
        await prisma.transaction.update({where: {id: seven.id}, data: {needsReview: true}});
        const again = await SortGroup({ids: [seven.id], category: "Shopping", always: true});
        expect(again).toMatchObject({ok: true, data: {rule: "Acme Depot"}});
        expect(await prisma.rule.findMany({where: {userId}, include: {category: true}})).toMatchObject([{category: {name: "Shopping"}}]);
        await prisma.rule.updateMany({where: {userId}, data: {categoryId: next.categoryId}});

        // Undo puts the first two back on Sort and removes the rule
        expect(await UndoSort(sorted.data.undo)).toEqual({ok: true, data: null});
        expect(await prisma.rule.count({where: {userId}})).toBe(0);
        expect(await prisma.transaction.count({where: {userId, needsReview: true}})).toBe(3);
        expect(await UndoSort(sorted.data.undo)).toEqual({ok: false, error: "Too late to undo that one"});
    });

    it("offers paid back and moves to Cash on the cards they fit", async () => {
        await prisma.userSettings.create({data: {userId, currency: "USD", selfNames: "Test User"}});
        const dinner = await SaveEntry({
            type: "expense", amount: 60, date: new Date(Date.UTC(2026, 9, 1)), description: "Dinner", accountId: chase.id, category: null,
            lines: [{amount: 30, category: {name: "Eating out", type: "expense"}}, {amount: 30, person: {name: "Alex Nguyen"}}],
        });
        expect(dinner.ok).toBe(true);
        await importLines([line("Zelle payment from ALEX NGUYEN BACw7h2k", 30, 4)]);
        // Imported while there was no Cash account, so it waits on Sort as spending
        await prisma.account.update({where: {id: cash.id}, data: {type: "checking", name: "Old checking"}});
        await importLines([line("ATM WITHDRAWAL 10/05 MAIN ST", -80, 5)]);
        await prisma.account.update({where: {id: cash.id}, data: {type: "cash", name: "Cash"}});

        const cards = (await getSortQueue(userId)).cards;
        const alex = cards.find((c) => c.person?.name === "Alex Nguyen")!;
        expect(alex).toMatchObject({paidBack: true, person: {owes: 30}, name: "Zelle from Alex Nguyen"});
        const atm = cards.find((c) => c.name === "ATM Withdrawal")!;
        expect(atm.transfer).toMatchObject({accountId: cash.id, into: true});

        expect((await MarkPaidBack({ids: alex.ids})).ok).toBe(true);
        expect((await MakeTransfer({ids: atm.ids, accountId: atm.transfer!.accountId})).ok).toBe(true);
        expect(await getBalance(cash)).toBe(100);
        expect(await prisma.transactionLine.count({where: {transaction: {userId}, personId: {not: null}}})).toBe(2);
        expect((await getSortQueue(userId)).cards).toHaveLength(0);
    });

    it("saves rules from Manage and files what they match", async () => {
        await importLines([line("ZORBLAX MEDIA 415-503-9235 CA", -7.99, 2), line("ZORBLAX MEDIA 415-503-9235 CA", -7.99, 9)]);
        await prisma.transaction.updateMany({where: {userId, date: new Date(Date.UTC(2026, 9, 2))}, data: {needsReview: false, categorizedBy: "you"}});

        const saved = await SaveRule({kind: "contains", pattern: "zorblax", direction: "expense",
            category: {name: "Subscriptions", type: "expense"}, rename: "Zorblax"});
        expect(saved).toEqual({ok: true, data: {applied: 1}});
        const again = await SaveRule({kind: "contains", pattern: "zorblax", direction: "expense",
            category: {name: "Subscriptions", type: "expense"}, rename: "Zorblax", applyToPast: true});
        expect(again).toEqual({ok: true, data: {applied: 2}});
        const crunchyroll = await prisma.transaction.findMany({where: {userId}, include: {category: true}});
        expect(crunchyroll.map((t) => [t.merchant, t.category.name, t.needsReview])).toEqual([
            ["Zorblax", "Subscriptions", false], ["Zorblax", "Subscriptions", false],
        ]);

        expect(await SaveRule({kind: "contains", pattern: "", category: {name: "Groceries", type: "expense"}}))
            .toEqual({ok: false, error: "Type the text to look for"});
        expect(await SaveRule({kind: "contains", pattern: "x"})).toEqual({ok: false, error: "Pick a category or a name to show"});

        const rules = await prisma.rule.findMany({where: {userId}});
        for (const r of rules) expect(await DeleteRule(r.id)).toEqual({ok: true, data: null});

        // Something filed by itself can go back to Sort
        expect(await ReturnToSort(crunchyroll[0].id)).toEqual({ok: true, data: null});
        expect(await prisma.transaction.count({where: {userId, needsReview: true}})).toBe(1);
    });
});
