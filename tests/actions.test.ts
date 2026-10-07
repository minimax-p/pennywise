import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";

// Calls the server actions directly against a real PostgreSQL database, with the session and Plaid mocked.
// Point TEST_DATABASE_URL at a disposable, migrated and seeded database; skipped otherwise.
const {testDatabaseUrl, userId, otherUserId} = vi.hoisted(() => {
    const {randomBytes, randomUUID} = require("node:crypto");
    const url = process.env.TEST_DATABASE_URL;
    if (url) process.env.DATABASE_URL = url;
    process.env.PLAID_TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    return {testDatabaseUrl: url, userId: `test-${randomUUID()}`, otherUserId: `test-${randomUUID()}`};
});

vi.mock("@/lib/auth", () => ({currentUser: vi.fn(async () => ({id: userId, firstName: null}))}));
vi.mock("next/navigation", () => ({
    redirect: vi.fn(() => {
        throw new Error("redirected");
    }),
}));

const plaid = vi.hoisted(() => ({
    transactionsSync: vi.fn(),
    linkTokenCreate: vi.fn(),
    itemPublicTokenExchange: vi.fn(),
    itemGet: vi.fn(),
    institutionsGetById: vi.fn(),
    itemRemove: vi.fn(),
}));
vi.mock("@/lib/plaid", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/lib/plaid")>(),
    plaidClient: plaid,
}));

import prisma from "@/lib/prisma";
import {decryptSecret, encryptSecret} from "@/lib/crypto";
import {CreateTransaction, DeleteTransaction, EditTransaction} from "@/app/(dashboard)/_actions/transactions";
import {CreateCategory, EditCategory} from "@/app/(dashboard)/_actions/categories";
import {CreatePlaidLinkToken, ExchangePlaidPublicToken, UnlinkPlaidItem} from "@/app/(dashboard)/_actions/plaid";
import {historyTotals} from "./reportHelpers";

const userIds = [userId, otherUserId];

const history = () => historyTotals(userId);

describe.skipIf(!testDatabaseUrl)("server actions", () => {
    beforeEach(async () => {
        Object.values(plaid).forEach((fn) => fn.mockReset());
        await prisma.transaction.deleteMany({where: {userId: {in: userIds}}});
        await prisma.plaidItem.deleteMany({where: {userId: {in: userIds}}});
        await prisma.category.deleteMany({where: {userId: {in: userIds}}});
    });

    afterAll(async () => {
        await prisma.transaction.deleteMany({where: {userId: {in: userIds}}});
        await prisma.plaidItem.deleteMany({where: {userId: {in: userIds}}});
        await prisma.category.deleteMany({where: {userId: {in: userIds}}});
        await prisma.$disconnect();
    });

    describe("transactions", () => {
        it("creates, edits and deletes a transaction and keeps history in step", async () => {
            await CreateTransaction({
                amount: 20, category: "Groceries", type: "expense",
                date: new Date("2026-09-10T00:00:00Z"), description: "Market",
            });
            const created = await prisma.transaction.findFirstOrThrow({where: {userId}, include: {category: true}});
            expect(created).toMatchObject({amount: 20, type: "expense", category: {name: "Groceries"}});
            expect(await history()).toEqual({
                days: [{month: 8, day: 10, income: 0, expense: 20}],
                months: [{month: 8, income: 0, expense: 20}],
            });

            await EditTransaction({
                id: created.id, type: "expense", amount: 35, category: "Restaurants",
                date: new Date("2026-10-02T00:00:00Z"), description: "Dinner",
            });
            expect(await prisma.transaction.findUniqueOrThrow({where: {id: created.id}, include: {category: true}}))
                .toMatchObject({amount: 35, description: "Dinner", type: "expense", category: {name: "Restaurants"}});
            expect(await history()).toEqual({
                days: [{month: 9, day: 2, income: 0, expense: 35}],
                months: [{month: 9, income: 0, expense: 35}],
            });

            await DeleteTransaction({id: created.id});
            expect(await prisma.transaction.count({where: {userId}})).toBe(0);
            expect(await history()).toEqual({days: [], months: []});
        });

        it("only accepts categories of the transaction's type", async () => {
            await expect(CreateTransaction({
                amount: 20, category: "Salary", type: "expense", date: new Date(),
            })).rejects.toThrow("There is no category called Salary");
        });

        it("cannot edit or delete another user's transaction", async () => {
            const category = await prisma.category.findFirstOrThrow({where: {name: "Groceries", isUniversal: true}});
            const theirs = await prisma.transaction.create({
                data: {userId: otherUserId, amount: 5, description: "", date: new Date(), type: "expense", categoryId: category.id},
            });
            await expect(DeleteTransaction({id: theirs.id})).rejects.toThrow("Transaction not found");
            await expect(EditTransaction({id: theirs.id, type: "expense", amount: 1, category: "Groceries", date: new Date()}))
                .rejects.toThrow("Transaction not found");
            expect(await prisma.transaction.findUnique({where: {id: theirs.id}})).not.toBeNull();
        });
    });

    describe("categories", () => {
        it("rejects names that clash with a universal category of the same type", async () => {
            await expect(CreateCategory({name: "Groceries", icon: "🥕", type: "expense"})).rejects.toThrow(/already exists/);
            // Universal "Groceries" is an expense category, so an income one is fine
            await expect(CreateCategory({name: "Groceries", icon: "🥕", type: "income"})).resolves.toMatchObject({userId});
            await CreateCategory({name: "Plants", icon: "🪴", type: "expense"});
            await expect(EditCategory({oldName: "Plants", newName: "Restaurants", icon: "🪴", type: "expense"}))
                .rejects.toThrow(/already exists/);
            // Renaming a category to itself, or changing only its case, is not a clash
            await expect(EditCategory({oldName: "Plants", newName: "plants", icon: "🌵", type: "expense"}))
                .resolves.toMatchObject({name: "plants", icon: "🌵"});
        });
    });

    describe("plaid", () => {
        it("creates link tokens for the signed-in user only", async () => {
            plaid.linkTokenCreate.mockResolvedValue({data: {link_token: "link-sandbox-1"}});
            expect(await CreatePlaidLinkToken()).toEqual({ok: true, data: {linkToken: "link-sandbox-1"}});
            expect(plaid.linkTokenCreate).toHaveBeenCalledWith(expect.objectContaining({
                user: {client_user_id: userId},
                products: ["transactions"],
            }));

            const theirs = await prisma.plaidItem.create({
                data: {userId: otherUserId, itemId: "their-item", accessToken: encryptSecret("access-theirs")},
            });
            expect(await CreatePlaidLinkToken(theirs.id)).toEqual({ok: false, error: "Bank connection not found"});
        });

        it("refuses to start linking without a valid encryption key", async () => {
            const key = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
            process.env.PLAID_TOKEN_ENCRYPTION_KEY = "too-short";
            try {
                expect(await CreatePlaidLinkToken()).toMatchObject({ok: false, error: expect.stringContaining("PLAID_TOKEN_ENCRYPTION_KEY")});
                expect(plaid.linkTokenCreate).not.toHaveBeenCalled();
            } finally {
                process.env.PLAID_TOKEN_ENCRYPTION_KEY = key;
            }
        });

        it("stores the access token encrypted, runs the first sync and refuses duplicate banks", async () => {
            plaid.itemPublicTokenExchange.mockResolvedValue({data: {access_token: "access-sandbox-secret", item_id: "item-1"}});
            plaid.itemGet.mockResolvedValue({data: {item: {institution_id: "ins_109508"}}});
            plaid.institutionsGetById.mockResolvedValue({data: {institution: {name: "First Platypus Bank"}}});
            plaid.transactionsSync.mockResolvedValue({
                data: {
                    added: [], modified: [], removed: [], has_more: false, next_cursor: "c1",
                    transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
                },
            });

            const result = await ExchangePlaidPublicToken("public-sandbox-1");
            expect(result).toMatchObject({ok: true, data: {institutionName: "First Platypus Bank", error: null}});

            const item = await prisma.plaidItem.findFirstOrThrow({where: {userId}});
            expect(item.accessToken).not.toContain("access-sandbox-secret");
            expect(decryptSecret(item.accessToken)).toBe("access-sandbox-secret");
            expect(item).toMatchObject({itemId: "item-1", institutionId: "ins_109508", cursor: "c1"});

            plaid.itemPublicTokenExchange.mockResolvedValue({data: {access_token: "access-sandbox-dupe", item_id: "item-2"}});
            plaid.itemRemove.mockResolvedValue({data: {}});
            const duplicate = await ExchangePlaidPublicToken("public-sandbox-2");
            expect(duplicate).toMatchObject({ok: false, error: expect.stringContaining("already linked")});
            expect(plaid.itemRemove).toHaveBeenCalledWith({access_token: "access-sandbox-dupe"});
            expect(await prisma.plaidItem.count({where: {userId}})).toBe(1);
        });

        it("unlinks a bank and optionally deletes its imported transactions", async () => {
            const category = await prisma.category.findFirstOrThrow({where: {name: "Groceries", isUniversal: true}});
            const date = new Date("2026-09-10T00:00:00Z");

            async function linkedItemWithTransaction(n: number) {
                const item = await prisma.plaidItem.create({
                    data: {userId, itemId: `item-unlink-${n}`, accessToken: encryptSecret(`access-${n}`)},
                });
                await CreateTransaction({amount: 10, category: "Groceries", type: "expense", date});
                await prisma.transaction.updateMany({
                    where: {userId, plaidItemId: null, plaidTransactionId: null},
                    data: {plaidItemId: item.id, plaidTransactionId: `plaid-${n}`, categoryId: category.id},
                });
                return item;
            }

            plaid.itemRemove.mockResolvedValue({data: {}});

            const kept = await linkedItemWithTransaction(1);
            expect(await UnlinkPlaidItem({id: kept.id, deleteTransactions: false}))
                .toEqual({ok: true, data: {deletedTransactions: 0}});
            expect(await prisma.transaction.findUniqueOrThrow({where: {plaidTransactionId: "plaid-1"}}))
                .toMatchObject({plaidItemId: null});

            const removed = await linkedItemWithTransaction(2);
            // Plaid already forgot about this item, which must not block unlinking
            plaid.itemRemove.mockRejectedValueOnce(Object.assign(new Error("gone"), {
                response: {data: {error_code: "ITEM_NOT_FOUND", error_message: "gone"}},
            }));
            expect(await UnlinkPlaidItem({id: removed.id, deleteTransactions: true}))
                .toEqual({ok: true, data: {deletedTransactions: 1}});
            expect(await prisma.transaction.findUnique({where: {plaidTransactionId: "plaid-2"}})).toBeNull();
            expect(await prisma.plaidItem.count({where: {userId}})).toBe(0);

            // A token encrypted with an old key can still be unlinked
            const stale = await prisma.plaidItem.create({
                data: {userId, itemId: "item-stale-key", accessToken: "v1:AAAA:AAAA:AAAA"},
            });
            plaid.itemRemove.mockClear();
            expect(await UnlinkPlaidItem({id: stale.id, deleteTransactions: false})).toMatchObject({ok: true});
            expect(plaid.itemRemove).not.toHaveBeenCalled();
            expect(await prisma.plaidItem.count({where: {userId}})).toBe(0);

            // Only the kept transaction is left in the totals
            expect(await history()).toEqual({
                days: [{month: 8, day: 10, income: 0, expense: 10}],
                months: [{month: 8, income: 0, expense: 10}],
            });
        });
    });
});
