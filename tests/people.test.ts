import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";

// Splits, people, cash and the Log a purchase shortcut against a real PostgreSQL database
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
import {getBalance} from "@/lib/accounts";
import {getCategoryTotals, getTotals} from "@/lib/reports";
import {getHome} from "@/lib/home";
import {linkZellePeople, personBalances} from "@/lib/people";
import {StatementRow} from "@/lib/import/parse";
import {commitImport, planImport} from "@/lib/import/plan";
import {SaveEntry} from "@/app/(dashboard)/_actions/transactions";
import {CheckBalance} from "@/app/(dashboard)/_actions/accounts";
import {MergePeople} from "@/app/(dashboard)/_actions/people";
import {UpdateSelfNames} from "@/app/(dashboard)/_actions/settings";
import {generateCaptureToken, hashCaptureToken} from "@/lib/capture";
import {POST as capture} from "@/app/api/capture/route";
import {GET as captureOptions} from "@/app/api/capture/options/route";

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12));
const october = () => getTotals(userId, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-31T23:59:59Z"));
const line = (description: string, amount: number, d: number): StatementRow =>
    ({date: new Date(Date.UTC(2026, 9, d)), amount, description, externalId: null, bankCategory: null, skipReason: null});

describe.skipIf(!testDatabaseUrl)("people, splits and cash", () => {
    let chase: Account, discover: Account, cash: Account, venmo: Account;

    async function cleanUp() {
        await prisma.importedRow.deleteMany({where: {account: {userId}}});
        await prisma.transaction.deleteMany({where: {userId}});
        await prisma.person.deleteMany({where: {userId}});
        await prisma.account.deleteMany({where: {userId}});
        await prisma.captureToken.deleteMany({where: {userId}});
        await prisma.userSettings.deleteMany({where: {userId}});
    }

    const account = (name: string, type: string, institution: string | null, balance: number) => prisma.account.create({
        data: {userId, name, type, institution, balanceChecks: {create: {date: new Date("2026-09-30T23:59:59.999Z"), balance, source: "you"}}},
    });

    beforeEach(async () => {
        await cleanUp();
        chase = await account("Chase checking", "checking", "Chase", 1000);
        discover = await account("Discover", "credit", "Discover", 0);
        cash = await account("Cash", "cash", null, 40);
        venmo = await account("Venmo", "wallet", "Venmo", 0);
    });

    afterAll(async () => {
        await cleanUp();
        await prisma.$disconnect();
    });

    it("splits a dinner: only your share is spending, the rest is owed to you", async () => {
        const result = await SaveEntry({
            type: "expense", amount: 90, date: day(2), description: "Olive Garden", accountId: discover.id, category: null,
            lines: [
                {amount: 30, category: {name: "Restaurants", type: "expense"}},
                {amount: 30, person: {name: "Alex Nguyen"}},
                {amount: 30, person: {name: "Mia Chen"}},
            ],
        });
        expect(result.ok).toBe(true);
        expect(await getBalance(discover)).toBe(-90);
        expect(await october()).toEqual({spending: 30, income: 0});
        expect((await getCategoryTotals(userId, day(1), day(31))).spending).toMatchObject([{name: "Restaurants", amount: 30}]);

        const alex = await prisma.person.findFirstOrThrow({where: {userId, name: "Alex Nguyen"}});
        expect((await personBalances(userId)).get(alex.id)).toBe(30);
        expect((await getHome(userId, day(7))).totals).toMatchObject({owedToYou: 60, netWorth: 1000 + 40 - 90 + 60});

        // Alex pays back by Zelle: not income, and Alex is settled
        expect((await SaveEntry({
            type: "income", amount: 30, date: day(4), description: "Zelle from Alex", accountId: chase.id, category: null,
            person: {id: alex.id}, lines: [{amount: 30, person: {id: alex.id}}],
        })).ok).toBe(true);
        expect(await october()).toEqual({spending: 30, income: 0});
        expect((await personBalances(userId)).get(alex.id)).toBe(0);
        expect((await getHome(userId, day(7))).totals.owedToYou).toBe(30);
    });

    it("refuses splits that don't add up", async () => {
        const base = {type: "expense" as const, amount: 50, date: day(3), description: "Target", accountId: discover.id, category: null};
        expect(await SaveEntry({...base, lines: [{amount: 20, category: {name: "Groceries", type: "expense"}}, {amount: 20, person: {name: "Sam"}}]}))
            .toEqual({ok: false, error: "The parts add up to 40.00, not 50.00"});
        expect(await SaveEntry({...base, lines: [{amount: 50, category: {name: "Salary", type: "income"}}]}))
            .toEqual({ok: false, error: "Pick a spending category"});
        expect(await SaveEntry({...base, lines: [{amount: 50, category: {name: "Groceries", type: "expense"}, person: {name: "Sam"}}]}))
            .toEqual({ok: false, error: "Each part of a split is a category or a person"});
        // A split with only your own share is just that category
        const single = await SaveEntry({...base, lines: [{amount: 50, category: {name: "Groceries", type: "expense"}}]});
        if (!single.ok) throw new Error(single.error);
        const saved = await prisma.transaction.findUniqueOrThrow({where: {id: single.data.id}, include: {category: true, lines: true}});
        expect([saved.category.name, saved.lines.length]).toEqual(["Groceries", 0]);
        // Later leaves it on the Sort page
        const later = await SaveEntry({...base, description: "Costco"});
        if (!later.ok) throw new Error(later.error);
        expect(await prisma.transaction.findUniqueOrThrow({where: {id: later.data.id}, include: {category: true}}))
            .toMatchObject({needsReview: true, category: {name: "Unsorted"}});
    });

    it("keeps a logged split when the statement shows a tip", async () => {
        const logged = await SaveEntry({
            type: "expense", amount: 80, date: day(5), description: "Thai Palace", accountId: discover.id, category: null,
            lines: [{amount: 40, category: {name: "Restaurants", type: "expense"}}, {amount: 40, person: {name: "Sam Friend"}}],
        });
        if (!logged.ok) throw new Error(logged.error);
        const plan = await planImport(userId, discover, [line("THAI PALACE NEW YORK NY", -88, 6)]);
        expect(plan[0]).toMatchObject({status: "match", linkTransactionId: logged.data.id});
        await commitImport(userId, discover, plan);
        const lines = await prisma.transactionLine.findMany({where: {transactionId: logged.data.id}, orderBy: {position: "asc"}});
        // The tip is yours; Sam still owes 40
        expect(lines.map((l) => l.amount)).toEqual([48, 40]);
        expect(await october()).toEqual({spending: 48, income: 0});
    });

    it("reads people from Zelle lines and links older ones", async () => {
        expect((await UpdateSelfNames("Test User")).ok).toBe(true);
        const plan = await planImport(userId, chase, [
            line("Zelle payment to DANA PARK JPM99abc123", -950, 1),
            line("Zelle payment from ALEX NGUYEN BACw7h2k", 30, 4),
            line("Zelle payment to TEST USER JPM99xyz", -100, 5),
        ]);
        expect(plan.map((r) => r.person)).toEqual(["DANA PARK", "ALEX NGUYEN", null]);
        await commitImport(userId, chase, plan);
        const people = await prisma.person.findMany({where: {userId}, orderBy: {name: "asc"}});
        expect(people.map((p) => [p.name, p.aliases])).toEqual([["Alex Nguyen", ["ALEX NGUYEN"]], ["Dana Park", ["DANA PARK"]]]);
        expect(await prisma.transaction.count({where: {userId, personId: {not: null}}})).toBe(2);

        // Imported before people were tracked
        const unsorted = await prisma.category.findFirstOrThrow({where: {name: "Unsorted", type: "expense", isUniversal: true}});
        await prisma.transaction.create({data: {
            userId, amount: 950, date: day(1), type: "expense", description: "Zelle payment to DANA PARK JPM99old", categoryId: unsorted.id, accountId: chase.id,
        }});
        expect(await linkZellePeople(userId)).toBe(1);
        expect(await prisma.transaction.count({where: {userId, person: {name: "Dana Park"}}})).toBe(2);

        // Two spellings of the same person become one
        const dana = people.find((p) => p.name === "Dana Park")!;
        const other = await prisma.person.create({data: {userId, name: "Dana P", aliases: ["DANA P"]}});
        await prisma.transaction.updateMany({where: {userId, description: {contains: "JPM99old"}}, data: {personId: other.id}});
        expect(await MergePeople(other.id, dana.id)).toEqual({ok: true, data: null});
        expect(await prisma.person.findUniqueOrThrow({where: {id: dana.id}})).toMatchObject({aliases: ["DANA PARK", "DANA P"]});
        expect(await prisma.transaction.count({where: {userId, personId: dana.id}})).toBe(2);
    });

    it("moves ATM cash into the wallet, and counts what you didn't log", async () => {
        expect((await UpdateSelfNames("Test User")).ok).toBe(true);
        const plan = await planImport(userId, chase, [
            line("ATM WITHDRAWAL 10/02 123 MAIN ST", -100, 2),
            line("NON-CHASE ATM FEE-WITH", -3, 2),
            line("ATM CASH DEPOSIT 10/05 ROUTE 17", 50, 5),
            line("VENMO* Test User Visa Direct NY", -20, 6),
        ]);
        expect(plan.map((r) => [r.kind, r.transferAccountId])).toEqual([
            ["transfer", cash.id],
            ["expense", null],
            ["transfer", cash.id],
            ["transfer", venmo.id],
        ]);
        expect(plan[1].category).toBe("Fees & interest");
        await commitImport(userId, chase, plan);
        expect(await getBalance(chase)).toBe(1000 - 100 - 3 + 50 - 20);
        expect(await getBalance(cash)).toBe(40 + 100 - 50);
        expect(await getBalance(venmo)).toBe(20);
        expect(await october()).toEqual({spending: 3, income: 0});

        // Count the wallet: $80 instead of $90
        const counted = await CheckBalance({accountId: cash.id, balance: 80, balanceDate: day(7), save: true, spend: true});
        expect(counted).toMatchObject({ok: true, data: {expected: 90, difference: -10, saved: true}});
        expect(await getBalance(cash)).toBe(80);
        expect(await october()).toEqual({spending: 13, income: 0});
        expect((await getCategoryTotals(userId, day(1), day(31))).spending.map((c) => [c.name, c.amount]))
            .toEqual([["Untracked cash", 10], ["Fees & interest", 3]]);
        expect(await CheckBalance({accountId: cash.id, balance: 95, balanceDate: day(8), save: true, spend: true}))
            .toEqual({ok: false, error: "Only less cash than expected can be counted as spending"});
    });

    it("logs from the Log a purchase shortcut with lists in order of use", async () => {
        const token = generateCaptureToken();
        await prisma.captureToken.create({data: {userId, name: "iPhone", tokenHash: hashCaptureToken(token)}});
        const headers = {authorization: `Bearer ${token}`, "x-forwarded-for": "198.51.100.40"};
        const groceries = await prisma.category.findFirstOrThrow({where: {name: "Groceries", type: "expense", isUniversal: true}});
        for (const d of [1, 2]) {
            await prisma.transaction.create({data: {
                userId, amount: 20, date: day(d), type: "expense", description: "Walmart", source: "manual",
                categoryId: groceries.id, accountId: discover.id, categorizedBy: "you",
            }});
        }

        const options = await (await captureOptions(new Request("http://localhost/api/capture/options", {headers}))).json();
        expect(options.places).toEqual(["Walmart", "New place…"]);
        expect(options.accounts.slice(0, 1)).toEqual(["Discover"]);
        expect(options.accounts).toEqual(expect.arrayContaining(["Chase checking", "Cash", "Venmo"]));
        expect(options.categories[0]).toBe("🛒 Groceries");
        expect(options.categories.slice(-2)).toEqual(["Sort later", "Split later"]);

        const post = (body: unknown) => capture(new Request("http://localhost/api/capture", {
            method: "POST", headers: {...headers, "content-type": "application/json"}, body: JSON.stringify(body),
        }));
        const logged = await post({amount: "86.40", merchant: "Walmart", account: "Discover", category: "🛒 Groceries", date: "2026-10-07T18:00:00"});
        expect(logged.status).toBe(201);
        const body = await logged.json();
        expect(body).toMatchObject({account: "Discover", category: "Groceries", needsReview: false});
        expect(body.message).toBe("Logged $86.40 at Walmart → 🛒 Groceries (Discover). Spending money is now $913.60.");
        expect(await prisma.transaction.findUniqueOrThrow({where: {id: body.id}})).toMatchObject({source: "shortcut", categorizedBy: "you"});

        const later = await (await post({amount: "12", merchant: "Farmers market", account: "Cash", category: "Sort later"})).json();
        expect(later).toMatchObject({account: "Cash", category: "Unsorted", needsReview: true});
        expect((await post({amount: "5", merchant: "X", account: "Amex"})).status).toBe(400);
        expect((await post({amount: "5", merchant: "X", account: "Cash", category: "Nope"})).status).toBe(400);
    });
});
