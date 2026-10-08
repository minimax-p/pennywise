import {afterAll, describe, expect, it, vi} from "vitest";

// Starting over against a real PostgreSQL database (TEST_DATABASE_URL); skipped otherwise.
const {testDatabaseUrl, userId} = vi.hoisted(() => {
    const {randomUUID} = require("node:crypto");
    const url = process.env.TEST_DATABASE_URL;
    if (url) process.env.DATABASE_URL = url;
    return {testDatabaseUrl: url, userId: `test-${randomUUID()}`};
});

vi.mock("@/lib/auth", () => ({currentUser: vi.fn(async () => ({id: userId, firstName: null}))}));
vi.mock("next/navigation", () => ({redirect: vi.fn(() => {
    throw new Error("redirected");
})}));

import prisma from "@/lib/prisma";
import {StartOver} from "@/app/(dashboard)/_actions/startOver";
import {SaveEntry} from "@/app/(dashboard)/_actions/transactions";

describe.skipIf(!testDatabaseUrl)("starting over", () => {
    afterAll(async () => {
        await prisma.$disconnect();
    });

    it("deletes transactions, then everything", async () => {
        await prisma.userSettings.create({data: {userId, currency: "USD"}});
        const chase = await prisma.account.create({data: {
            userId, name: "Chase", type: "checking",
            balanceChecks: {create: [
                {date: new Date("2026-09-30T23:59:59.999Z"), balance: 100, source: "you"},
                {date: new Date("2026-10-05T23:59:59.999Z"), balance: 80, source: "statement"},
            ]},
        }});
        const saved = await SaveEntry({
            type: "expense", amount: 20, date: new Date("2026-10-02T12:00:00Z"), description: "Dinner", accountId: chase.id, category: null,
            lines: [{amount: 10, category: {name: "Eating out", type: "expense"}}, {amount: 10, person: {name: "Sam"}}],
        });
        if (!saved.ok) throw new Error(saved.error);
        await prisma.importedRow.create({data: {accountId: chase.id, fingerprint: "h:1", transactionId: saved.data.id}});
        await prisma.category.create({data: {userId, name: "Plants", icon: "🪴", type: "expense"}});

        expect(await StartOver("transactions", "nope")).toEqual({ok: false, error: "Type DELETE to confirm"});
        expect(await StartOver("transactions", "delete")).toEqual({ok: true, data: {transactions: 1}});
        expect(await prisma.transaction.count({where: {userId}})).toBe(0);
        expect(await prisma.importedRow.count({where: {accountId: chase.id}})).toBe(0);
        // The balance you typed stays; the statement's goes
        expect(await prisma.balanceCheck.findMany({where: {accountId: chase.id}, select: {source: true}})).toEqual([{source: "you"}]);
        expect(await prisma.person.count({where: {userId}})).toBe(1);
        expect(await prisma.category.count({where: {userId}})).toBe(1);

        expect(await StartOver("everything", "DELETE")).toEqual({ok: true, data: {transactions: 0}});
        for (const count of [
            prisma.account.count({where: {userId}}), prisma.person.count({where: {userId}}),
            prisma.category.count({where: {userId}}), prisma.userSettings.count({where: {userId}}),
        ]) expect(await count).toBe(0);
        expect(await prisma.category.findUnique({where: {key: "eating-out"}})).toMatchObject({name: "Eating out", hidden: false});
    });
});
