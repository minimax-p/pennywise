import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";

// The built-in categories against a real PostgreSQL database (TEST_DATABASE_URL); skipped otherwise.
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
import {suggestCategories} from "@/lib/categorize/suggest";
import {UpdateCategory} from "@/app/(dashboard)/_actions/categories";
import {CATEGORIES, LEGACY} from "@/prisma/categories.mjs";

const suggest = async (description: string) =>
    (await suggestCategories(userId, [{description, amount: -10, date: new Date(), bankCategory: null}]))[0];

describe("the category list", () => {
    it("gives every built-in category a unique key and name, and maps every old one", () => {
        expect(new Set(CATEGORIES.map((c) => c.key)).size).toBe(CATEGORIES.length);
        expect(new Set(CATEGORIES.map((c) => `${c.type}:${c.name}`)).size).toBe(CATEGORIES.length);
        const keys = new Set(CATEGORIES.map((c) => c.key));
        for (const [type, map] of Object.entries(LEGACY)) {
            for (const [name, key] of Object.entries(map)) {
                expect(keys.has(key), `${type} ${name} → ${key}`).toBe(true);
                expect(CATEGORIES.find((c) => c.key === key)?.type, `${type} ${name}`).toBe(type);
            }
        }
    });
});

describe.skipIf(!testDatabaseUrl)("built-in categories", () => {
    const original = new Map<string, { name: string, hidden: boolean }>();

    beforeEach(async () => {
        for (const key of ["coffee-snacks", "gas"]) {
            const category = await prisma.category.findUniqueOrThrow({where: {key}});
            if (!original.has(key)) original.set(key, {name: category.name, hidden: category.hidden});
            await prisma.category.update({where: {key}, data: original.get(key)!});
        }
    });

    afterAll(async () => {
        for (const [key, data] of original) await prisma.category.update({where: {key}, data});
        await prisma.$disconnect();
    });

    it("keeps sorting by keyword after you rename or hide one", async () => {
        expect(await suggest("STARBUCKS STORE 123")).toMatchObject({name: "Coffee & snacks", source: "keyword"});
        expect(await suggest("SUNOCO 0123")).toMatchObject({name: "Gas", source: "keyword"});

        const coffee = await prisma.category.findUniqueOrThrow({where: {key: "coffee-snacks"}});
        expect(await UpdateCategory({id: coffee.id, name: "Coffee", icon: "☕", group: "Food", hidden: false})).toEqual({ok: true, data: null});
        expect(await suggest("STARBUCKS STORE 123")).toMatchObject({name: "Coffee", source: "keyword"});

        // A hidden category isn't suggested any more
        const gas = await prisma.category.findUniqueOrThrow({where: {key: "gas"}});
        expect(await UpdateCategory({id: gas.id, name: "Gas", icon: "⛽", group: "Getting around", hidden: true})).toEqual({ok: true, data: null});
        expect(await suggest("SUNOCO 0123")).toMatchObject({name: "Unsorted", source: "none"});
    });
});
