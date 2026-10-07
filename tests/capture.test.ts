import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";

// The Apple Pay capture endpoint against a real PostgreSQL database (TEST_DATABASE_URL); skipped otherwise.
const {testDatabaseUrl, userId} = vi.hoisted(() => {
    const {randomUUID} = require("node:crypto");
    const url = process.env.TEST_DATABASE_URL;
    if (url) process.env.DATABASE_URL = url;
    return {testDatabaseUrl: url, userId: `test-${randomUUID()}`};
});

import {Account} from "@prisma/client";
import prisma from "@/lib/prisma";
import {historyTotals} from "./reportHelpers";
import {findAccountForCard, generateCaptureToken, hashCaptureToken, parseShortcutDate} from "@/lib/capture";
import {POST} from "@/app/api/capture/route";
import {byMerchant, startFakeJev} from "./fakeJev";

describe("capture helpers", () => {
    const accounts = [
        {id: "a", walletCardName: "Discover it", archived: false},
        {id: "b", walletCardName: "Chase Debit", archived: false},
        {id: "c", walletCardName: "Old Card", archived: true},
        {id: "d", walletCardName: null, archived: false},
    ];

    it("matches Apple Wallet card names loosely", () => {
        expect(findAccountForCard(accounts, "Discover it")?.id).toBe("a");
        expect(findAccountForCard(accounts, "discover it card")?.id).toBe("a");
        expect(findAccountForCard(accounts, "Chase")?.id).toBe("b");
        expect(findAccountForCard(accounts, "Old Card")).toBeNull();
        expect(findAccountForCard(accounts, "Amex")).toBeNull();
        expect(findAccountForCard(accounts, undefined)).toBeNull();
    });

    it("reads dates Shortcuts sends as wall-clock time", () => {
        expect(parseShortcutDate("2026-10-06T20:15:00")).toEqual(new Date("2026-10-06T20:15:00Z"));
        expect(parseShortcutDate("2026-10-06")).toEqual(new Date("2026-10-06T00:00:00Z"));
        expect(parseShortcutDate("Oct 6, 2026 at 8:15 PM")).toEqual(new Date("2026-10-06T20:15:00Z"));
        expect(parseShortcutDate("not a date")).toBeNull();
    });

    it("stores only a hash of keys", () => {
        const token = generateCaptureToken();
        expect(token).toMatch(/^pw_[A-Za-z0-9_-]{43}$/);
        expect(hashCaptureToken(token)).toHaveLength(64);
        expect(hashCaptureToken(token)).not.toContain(token);
    });
});

describe.skipIf(!testDatabaseUrl)("POST /api/capture", () => {
    let token: string;
    let discover: Account;

    const capture = (body: unknown, auth = `Bearer ${token}`, ip = "198.51.100.20") => POST(new Request("http://localhost/api/capture", {
        method: "POST",
        headers: {"content-type": "application/json", authorization: auth, "x-forwarded-for": ip},
        body: typeof body === "string" ? body : JSON.stringify(body),
    }));

    beforeAll(async () => {
        token = generateCaptureToken();
        await prisma.captureToken.create({data: {userId, name: "iPhone", tokenHash: hashCaptureToken(token)}});
        discover = await prisma.account.create({data: {userId, name: "Discover", type: "credit", walletCardName: "Discover it"}});
    });

    afterAll(async () => {
        await prisma.transaction.deleteMany({where: {userId}});
        await prisma.captureToken.deleteMany({where: {userId}});
        await prisma.account.deleteMany({where: {userId}});
        await prisma.$disconnect();
    });

    it("logs a purchase in the card's account with a suggested category", async () => {
        const response = await capture({amount: "$4.50", merchant: "Blue Bottle Coffee", card: "Discover it", date: "2026-10-06T08:15:00"});
        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body).toMatchObject({account: "Discover", category: "Unsorted"});
        expect(body.message).toBe("Logged $4.50 at Blue Bottle Coffee (Discover). Sort it in Pennywise.");
        expect(body.needsReview).toBe(true);

        expect(await prisma.transaction.findUniqueOrThrow({where: {id: body.id}})).toMatchObject({
            amount: 4.5, type: "expense", source: "apple_pay", accountId: discover.id,
            date: new Date("2026-10-06T08:15:00Z"), payeeKey: "BLUE BOTTLE", needsReview: true,
        });
        expect((await historyTotals(userId)).days).toEqual([{month: 9, day: 6, income: 0, expense: 4.5}]);
        expect((await prisma.captureToken.findFirstOrThrow({where: {userId}})).lastUsedAt).not.toBeNull();
    });

    it("ignores the same purchase sent twice within two minutes", async () => {
        const response = await capture({amount: 4.5, merchant: "Blue Bottle Coffee", card: "Discover it"});
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({duplicate: true});
        expect(await prisma.transaction.count({where: {userId}})).toBe(1);
    });

    it("uses the category picked last time for the merchant", async () => {
        const coffee = await prisma.category.findFirstOrThrow({where: {name: "Coffee & snacks", type: "expense", isUniversal: true}});
        // As if sorted on the Sort page
        await prisma.transaction.updateMany({where: {userId}, data: {categoryId: coffee.id, needsReview: false, categorizedBy: "you"}});

        const response = await capture({amount: "5.25", merchant: "Blue Bottle Coffee", card: "Unknown Card", date: "2026-10-07T09:00:00"});
        expect(await response.json()).toMatchObject({category: "Coffee & snacks", account: null});
    });

    it("lets Jev sort purchases from new merchants as they come in", async () => {
        const jev = await startFakeJev(byMerchant({"SHELL": ["Gas", 0.97], "CORNER": ["Shopping", 0.4]}));
        try {
            const sure = await (await capture({amount: "45.10", merchant: "Shell", card: "Discover it", date: "2026-10-08T12:00:00"})).json();
            expect(sure).toMatchObject({category: "Gas", needsReview: false});
            const unsure = await (await capture({amount: "3.00", merchant: "Corner Store", card: "Discover it", date: "2026-10-08T13:00:00"})).json();
            expect(unsure).toMatchObject({category: "Shopping", needsReview: true});
            expect(unsure.message).toMatch(/Sort it in Pennywise/);
        } finally {
            await jev.stop();
        }
    });

    it("rejects bad keys and bad bodies", async () => {
        expect((await capture({amount: 1, merchant: "X"}, "Bearer pw_wrong", "198.51.100.30")).status).toBe(401);
        expect((await capture({amount: 1, merchant: "X"}, "", "198.51.100.30")).status).toBe(401);
        expect((await capture("not json")).status).toBe(400);
        expect((await capture({amount: "free", merchant: "X"})).status).toBe(400);
        expect((await capture({amount: 3})).status).toBe(400);
    });

    it("locks out an address after repeated bad keys", async () => {
        for (let i = 0; i < 5; i++) await capture({amount: 1, merchant: "X"}, "Bearer pw_guess", "198.51.100.40");
        expect((await capture({amount: 1, merchant: "X"}, `Bearer ${token}`, "198.51.100.40")).status).toBe(429);
    });
});
