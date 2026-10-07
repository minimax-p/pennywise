import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

// Sorting and AI suggestions against a real PostgreSQL database (TEST_DATABASE_URL), with a fake Jev server.
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
import {historyTotals} from "./reportHelpers";
import {StatementRow} from "@/lib/import/parse";
import {commitImport, planImport} from "@/lib/import/plan";
import {suggestCategories} from "@/lib/categorize/suggest";
import {AcceptSuggestions, AskAiToSort, SortTransaction} from "@/app/(dashboard)/_actions/review";
import {byMerchant, startFakeJev} from "./fakeJev";

const row = (description: string, amount: number, day = 5): StatementRow => ({
    date: new Date(Date.UTC(2026, 9, day)), amount, description, externalId: null, bankCategory: null, skipReason: null,
});

describe.skipIf(!testDatabaseUrl)("sorting transactions", () => {
    let account: Account;
    let jev: Awaited<ReturnType<typeof startFakeJev>> | null = null;

    const useJev = async (rules: Record<string, [string, number]>) => {
        jev = await startFakeJev(byMerchant(rules));
        return jev;
    };

    async function cleanUp() {
        await prisma.importedRow.deleteMany({where: {account: {userId}}});
        await prisma.transaction.deleteMany({where: {userId}});
    }

    async function importRows(rows: StatementRow[]) {
        const plan = await planImport(userId, account, rows);
        await commitImport(userId, account, plan);
        return plan;
    }

    const byDescription = (description: string) => prisma.transaction.findFirstOrThrow({
        where: {userId, description}, include: {category: true},
    });

    beforeAll(async () => {
        account = await prisma.account.create({data: {userId, name: "Discover it", type: "credit", institution: "Discover"}});
    });
    beforeEach(cleanUp);
    afterEach(async () => {
        await jev?.stop();
        jev = null;
    });
    afterAll(async () => {
        await cleanUp();
        await prisma.account.deleteMany({where: {userId}});
        await prisma.$disconnect();
    });

    it("files confident AI answers and leaves unsure ones on the Sort page", async () => {
        const fake = await useJev({"BLUE BOTTLE": ["Coffee & snacks", 0.93], "MYSTERY": ["Shopping", 0.35]});
        const plan = await importRows([
            row("SQ *BLUE BOTTLE COFFEE #12 OAKLAND CA", -6.75, 5),
            row("SQ *BLUE BOTTLE COFFEE #12 OAKLAND CA", -4.25, 6),
            row("MYSTERY SHOP 991", -20, 7),
            row("DISCOVER CASHBACK BONUS", 12, 8),
        ]);
        expect(plan.map((p) => [p.category, p.suggestion?.source])).toEqual([
            ["Coffee & snacks", "ai"], ["Coffee & snacks", "ai"], ["Shopping", "ai"], ["Interest", "keyword"],
        ]);
        // One question per merchant, and none for lines a keyword already sorted
        expect(fake.requests).toHaveLength(2);

        expect(await byDescription("SQ *BLUE BOTTLE COFFEE #12 OAKLAND CA")).toMatchObject({
            needsReview: false, categorizedBy: "ai", categoryConfidence: 0.93, category: {name: "Coffee & snacks"},
        });
        const unsure = await byDescription("MYSTERY SHOP 991");
        expect(unsure).toMatchObject({needsReview: true, categorizedBy: "ai", category: {name: "Shopping"}});
        expect((unsure.aiSuggestions as { name: string }[])[0].name).toBe("Shopping");
    });

    it("prefers your own past choice over asking Jev, and AI guesses don't teach", async () => {
        const fake = await useJev({"BLUE BOTTLE": ["Eating out", 0.95]});
        await importRows([row("SQ *BLUE BOTTLE COFFEE #12", -5, 1)]);
        // Jev's guess was filed, but it is not your choice, so it is asked again next time
        await importRows([row("SQ *BLUE BOTTLE COFFEE #12", -5.5, 2)]);
        expect(fake.requests).toHaveLength(2);

        const first = await byDescription("SQ *BLUE BOTTLE COFFEE #12");
        await SortTransaction({id: first.id, category: "Coffee & snacks", applyToMerchant: false});

        const [suggestion] = await suggestCategories(userId, [{...row("SQ *BLUE BOTTLE COFFEE #99", -7, 3)}]);
        expect(suggestion).toMatchObject({name: "Coffee & snacks", source: "history"});
        expect(fake.requests).toHaveLength(2);
    });

    it("sorts every waiting transaction from the same merchant at once", async () => {
        await importRows([row("WEIRD MERCHANT 1", -3, 1), row("WEIRD MERCHANT 2", -4, 2), row("OTHER PLACE", -5, 3)]);
        const waiting = await prisma.transaction.findMany({where: {userId, needsReview: true}});
        expect(waiting).toHaveLength(3);

        const first = waiting.find((t) => t.description === "WEIRD MERCHANT 1")!;
        const result = await SortTransaction({id: first.id, category: "Groceries", applyToMerchant: true});
        expect(result).toEqual({ok: true, data: {sorted: 2}});

        const after = await prisma.transaction.findMany({where: {userId}, include: {category: true}, orderBy: {amount: "asc"}});
        expect(after.map((t) => [t.description, t.category.name, t.needsReview])).toEqual([
            ["WEIRD MERCHANT 1", "Groceries", false],
            ["WEIRD MERCHANT 2", "Groceries", false],
            ["OTHER PLACE", "Unsorted", true],
        ]);
        // The month totals are unchanged by sorting
        expect((await historyTotals(userId)).months).toEqual([{month: 9, income: 0, expense: 12}]);
    });

    it("keeps all suggestions at once, except lines with no category yet", async () => {
        await useJev({"MAYBE SPOT": ["Coffee & snacks", 0.5]});
        await importRows([row("MAYBE SPOT", -3, 1)]);
        await jev!.stop();
        jev = null;
        // Without Jev this one stays Unsorted
        await importRows([row("NOTHING KNOWN", -4, 2)]);
        const ids = (await prisma.transaction.findMany({where: {userId, needsReview: true}})).map((t) => t.id);
        expect(ids).toHaveLength(2);

        expect(await AcceptSuggestions({ids})).toEqual({ok: true, data: {accepted: 1}});
        expect(await byDescription("MAYBE SPOT")).toMatchObject({needsReview: false, categorizedBy: "you"});
        expect(await byDescription("NOTHING KNOWN")).toMatchObject({needsReview: true, category: {name: "Unsorted"}});
    });

    it("asks Jev to sort what is waiting, once per transaction", async () => {
        await importRows([row("LUIGI PLACE", -18, 1), row("ODD THING", -9, 2)]);
        expect(await AskAiToSort()).toEqual({ok: false, error: expect.stringContaining("TYPESAFE_API_KEY")});

        const fake = await useJev({"LUIGI": ["Eating out", 0.88], "ODD": ["Shopping", 0.3]});
        expect(await AskAiToSort()).toEqual({ok: true, data: {sorted: 1, suggested: 1, left: 1}});
        expect(await byDescription("LUIGI PLACE")).toMatchObject({needsReview: false, category: {name: "Eating out"}});
        expect(await byDescription("ODD THING")).toMatchObject({needsReview: true, category: {name: "Shopping"}});

        // The unsure one was already asked; asking again doesn't repeat the call
        const calls = fake.requests.length;
        await AskAiToSort();
        expect(fake.requests.length).toBe(calls);
    });
});
