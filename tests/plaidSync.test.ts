import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";
import {randomBytes, randomUUID} from "node:crypto";
import {plaidTransaction} from "./factories";

// Runs against a real PostgreSQL database. Point TEST_DATABASE_URL at a disposable database
// with migrations applied (npx prisma migrate deploy); the test is skipped otherwise.
const testDatabaseUrl = vi.hoisted(() => {
    const url = process.env.TEST_DATABASE_URL;
    if (url) process.env.DATABASE_URL = url;
    process.env.PLAID_TOKEN_ENCRYPTION_KEY ??= require("node:crypto").randomBytes(32).toString("base64");
    return url;
});

const transactionsSync = vi.hoisted(() => vi.fn());
vi.mock("@/lib/plaid", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/lib/plaid")>(),
    plaidClient: {transactionsSync},
}));

import prisma from "@/lib/prisma";
import {historyTotals} from "./reportHelpers";
import {encryptSecret} from "@/lib/crypto";
import {syncPlaidItem} from "@/lib/plaidSync";

function syncPage(page: { added?: unknown[], modified?: unknown[], removed?: unknown[], next_cursor: string, has_more?: boolean }) {
    return {
        data: {
            added: [], modified: [], removed: [], has_more: false,
            transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
            accounts: [], request_id: "req",
            ...page,
        },
    };
}

function plaidApiError(code: string) {
    return Object.assign(new Error(code), {response: {data: {error_code: code, error_message: code}}});
}

describe.skipIf(!testDatabaseUrl)("syncPlaidItem", () => {
    const userId = `test-${randomUUID()}`;

    async function createItem() {
        return prisma.plaidItem.create({
            data: {
                userId,
                itemId: `item-${randomUUID()}`,
                accessToken: encryptSecret("access-sandbox-test"),
                institutionName: "Test Bank",
            },
        });
    }

    async function history() {
        const {days, months} = await historyTotals(userId);
        return {days: days.map(({day, income, expense}) => ({day, income, expense})), months};
    }

    beforeEach(() => {
        transactionsSync.mockReset();
    });

    afterAll(async () => {
        await prisma.transaction.deleteMany({where: {userId}});
        await prisma.plaidItem.deleteMany({where: {userId}});
        await prisma.$disconnect();
    });

    it("imports, updates and removes transactions and keeps history totals in step", async () => {
        const item = await createItem();
        const id = () => `${item.id}-${randomBytes(4).toString("hex")}`;
        const restaurant = id(), salary = id(), groceries = id(), flight = id();

        transactionsSync
            .mockResolvedValueOnce(syncPage({
                added: [
                    plaidTransaction({transaction_id: restaurant, amount: 12.5, date: "2026-09-10"}),
                    plaidTransaction({
                        transaction_id: salary, amount: -1000, date: "2026-09-15",
                        personal_finance_category: {primary: "INCOME", detailed: "INCOME_WAGES"},
                    }),
                    plaidTransaction({
                        transaction_id: id(), amount: 300,
                        personal_finance_category: {primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER"},
                    }),
                    plaidTransaction({transaction_id: id(), amount: 8, pending: true}),
                ],
                next_cursor: "c1",
                has_more: true,
            }))
            .mockResolvedValueOnce(syncPage({
                added: [
                    plaidTransaction({
                        transaction_id: groceries, amount: 40, date: "2026-09-10",
                        personal_finance_category: {primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES"},
                    }),
                    plaidTransaction({
                        transaction_id: flight, amount: 200, date: "2026-09-20",
                        personal_finance_category: {primary: "TRAVEL", detailed: "TRAVEL_FLIGHTS"},
                    }),
                ],
                // Modified on a later page than it was added: the latest version wins
                modified: [plaidTransaction({transaction_id: restaurant, amount: 15, date: "2026-09-10"})],
                next_cursor: "c2",
            }));

        const first = await syncPlaidItem(item);
        expect(first).toMatchObject({added: 4, modified: 0, removed: 0, error: null, notReady: false});
        expect(transactionsSync).toHaveBeenNthCalledWith(1, expect.objectContaining({cursor: undefined}));
        expect(transactionsSync).toHaveBeenNthCalledWith(2, expect.objectContaining({cursor: "c1"}));

        const imported = await prisma.transaction.findMany({where: {userId}, include: {category: true}});
        const byPlaidId = new Map(imported.map((t) => [t.plaidTransactionId, t]));
        expect(byPlaidId.get(restaurant)).toMatchObject({amount: 15, type: "expense", category: {name: "Restaurants"}});
        expect(byPlaidId.get(salary)).toMatchObject({amount: 1000, type: "income", category: {name: "Salary"}});
        expect(byPlaidId.get(groceries)).toMatchObject({category: {name: "Groceries"}});
        expect(byPlaidId.get(flight)).toMatchObject({category: {name: "Unsorted", type: "expense"}});

        expect(await history()).toEqual({
            days: [
                {day: 10, income: 0, expense: 55},
                {day: 15, income: 1000, expense: 0},
                {day: 20, income: 0, expense: 200},
            ],
            months: [{month: 8, income: 1000, expense: 255}],
        });
        expect((await prisma.plaidItem.findUniqueOrThrow({where: {id: item.id}})).cursor).toBe("c2");

        // The user renames a transaction, then the bank corrects its amount and date
        await prisma.transaction.update({where: {plaidTransactionId: groceries}, data: {description: "Weekly shop"}});
        // And the user deletes one, which the bank later modifies
        await prisma.transaction.delete({where: {plaidTransactionId: flight}});

        transactionsSync.mockResolvedValueOnce(syncPage({
            modified: [
                plaidTransaction({
                    transaction_id: groceries, amount: 45, date: "2026-09-11",
                    personal_finance_category: {primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES"},
                }),
                plaidTransaction({transaction_id: flight, amount: 210, date: "2026-09-20"}),
            ],
            removed: [{transaction_id: salary, account_id: "account-1"}],
            next_cursor: "c3",
        }));

        const second = await syncPlaidItem(await prisma.plaidItem.findUniqueOrThrow({where: {id: item.id}}));
        expect(second).toMatchObject({added: 0, modified: 1, removed: 1});
        expect(transactionsSync).toHaveBeenLastCalledWith(expect.objectContaining({cursor: "c2"}));

        expect(await prisma.transaction.findUnique({where: {plaidTransactionId: groceries}}))
            .toMatchObject({amount: 45, description: "Weekly shop", date: new Date("2026-09-11T00:00:00Z")});
        expect(await prisma.transaction.findUnique({where: {plaidTransactionId: salary}})).toBeNull();
        expect(await prisma.transaction.findUnique({where: {plaidTransactionId: flight}})).toBeNull();

        expect(await history()).toEqual({
            days: [
                {day: 10, income: 0, expense: 15},
                {day: 11, income: 0, expense: 45},
            ],
            months: [{month: 8, income: 0, expense: 60}],
        });
    });

    it("restarts pagination when Plaid reports a mutation mid-way", async () => {
        const item = await createItem();
        const first = `${item.id}-a`, second = `${item.id}-b`;

        transactionsSync
            .mockResolvedValueOnce(syncPage({added: [plaidTransaction({transaction_id: first})], next_cursor: "p1", has_more: true}))
            .mockRejectedValueOnce(plaidApiError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"))
            .mockResolvedValueOnce(syncPage({added: [plaidTransaction({transaction_id: first})], next_cursor: "p1", has_more: true}))
            .mockResolvedValueOnce(syncPage({added: [plaidTransaction({transaction_id: second})], next_cursor: "p2"}));

        const result = await syncPlaidItem(item);
        expect(result.added).toBe(2);
        expect(transactionsSync).toHaveBeenCalledTimes(4);
        expect(await prisma.transaction.count({where: {plaidItemId: item.id}})).toBe(2);
    });

    it("applies changes once when two syncs of the same item overlap", async () => {
        const item = await createItem();
        transactionsSync.mockResolvedValue(syncPage({
            added: [plaidTransaction({transaction_id: `${item.id}-x`, amount: 25, date: "2026-07-04"})],
            next_cursor: "after",
        }));

        // Both start from the same stale item, as with Sync and Sync all clicked together
        const results = await Promise.all([syncPlaidItem(item), syncPlaidItem(item)]);
        expect(results.map((r) => r.added).sort()).toEqual([0, 1]);
        expect(await prisma.transaction.count({where: {plaidItemId: item.id}})).toBe(1);
        expect((await historyTotals(userId)).months).toContainEqual({month: 6, income: 0, expense: 25});
    });

    it("records Plaid errors on the item without moving the cursor", async () => {
        const item = await prisma.plaidItem.update({where: {id: (await createItem()).id}, data: {cursor: "keep"}});
        transactionsSync.mockRejectedValueOnce(plaidApiError("ITEM_LOGIN_REQUIRED"));

        const result = await syncPlaidItem(item);
        expect(result.error).toBe("ITEM_LOGIN_REQUIRED");
        expect(await prisma.plaidItem.findUniqueOrThrow({where: {id: item.id}}))
            .toMatchObject({error: "ITEM_LOGIN_REQUIRED", cursor: "keep"});

        // The next successful sync clears it
        transactionsSync.mockResolvedValueOnce(syncPage({next_cursor: "next"}));
        await syncPlaidItem(item);
        expect(await prisma.plaidItem.findUniqueOrThrow({where: {id: item.id}}))
            .toMatchObject({error: null, cursor: "next"});
    });

    it("reports when Plaid is still preparing the first batch", async () => {
        const item = await createItem();
        transactionsSync.mockResolvedValueOnce({
            data: {...syncPage({next_cursor: ""}).data, transactions_update_status: "NOT_READY"},
        });
        const result = await syncPlaidItem(item);
        expect(result.notReady).toBe(true);
        expect((await prisma.plaidItem.findUniqueOrThrow({where: {id: item.id}})).cursor).toBeNull();
    });
});
