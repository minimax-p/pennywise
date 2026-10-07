import {Category, PlaidItem} from "@prisma/client";
import {RemovedTransaction, Transaction as PlaidTransaction, TransactionsUpdateStatus} from "plaid";
import prisma from "@/lib/prisma";
import {categoryByKey} from "@/lib/categoryKeys";
import {getPlaidError, plaidClient} from "@/lib/plaid";
import {decryptSecret} from "@/lib/crypto";
import {convertPlaidTransaction} from "@/lib/plaidTransactions";
import {TransactionType} from "@/lib/types";

export type PlaidSyncResult = {
    itemId: string;
    institutionName: string | null;
    added: number;
    modified: number;
    removed: number;
    // True while Plaid is still pulling the first batch of transactions from the bank
    notReady: boolean;
    // Plaid error code, e.g. ITEM_LOGIN_REQUIRED when the user must log in to their bank again
    error: string | null;
};

const MAX_PAGINATION_RESTARTS = 3;

class ConcurrentSyncError extends Error {}

async function fetchSyncUpdates(accessToken: string, startCursor: string | null) {
    for (let attempt = 0; ; attempt++) {
        const added: PlaidTransaction[] = [];
        const modified: PlaidTransaction[] = [];
        const removed: RemovedTransaction[] = [];
        let cursor = startCursor || undefined;
        let status: TransactionsUpdateStatus | undefined;

        try {
            let hasMore = true;
            while (hasMore) {
                const {data} = await plaidClient.transactionsSync({access_token: accessToken, cursor, count: 500});
                added.push(...data.added);
                modified.push(...data.modified);
                removed.push(...data.removed);
                cursor = data.next_cursor || undefined;
                hasMore = data.has_more;
                status = data.transactions_update_status;
            }
            return {added, modified, removed, cursor: cursor ?? null, status};
        } catch (error) {
            // Plaid asks to restart pagination from the first cursor when data changes mid-way
            if (getPlaidError(error)?.error_code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"
                && attempt < MAX_PAGINATION_RESTARTS) {
                continue;
            }
            throw error;
        }
    }
}

// Built-in categories by key; money that doesn't fit the category's type, or has none, is Unsorted
async function loadCategoryLookup() {
    const categories = await prisma.category.findMany({where: {key: {not: null}}});
    const unsorted = {
        income: await categoryByKey("unsorted-income"),
        expense: await categoryByKey("unsorted-expense"),
    };
    return (type: TransactionType, key: string | null): Category => {
        const category = key ? categories.find((c) => c.key === key) : undefined;
        return category && category.type === type ? category : unsorted[type];
    };
}

export async function syncPlaidItem(item: PlaidItem): Promise<PlaidSyncResult> {
    const result: PlaidSyncResult = {
        itemId: item.id,
        institutionName: item.institutionName,
        added: 0,
        modified: 0,
        removed: 0,
        notReady: false,
        error: null,
    };

    let updates: Awaited<ReturnType<typeof fetchSyncUpdates>>;
    try {
        updates = await fetchSyncUpdates(decryptSecret(item.accessToken), item.cursor);
    } catch (error) {
        const plaidError = getPlaidError(error);
        if (!plaidError) throw error;
        await prisma.plaidItem.update({where: {id: item.id}, data: {error: plaidError.error_code}});
        return {...result, error: plaidError.error_code};
    }

    result.notReady = updates.status === TransactionsUpdateStatus.NotReady;
    const categoryFor = await loadCategoryLookup();

    const removedIds = new Set(updates.removed.map((t) => t.transaction_id));
    // Later pages override earlier ones, so these maps hold the latest version of each transaction
    const addedById = new Map(updates.added.map((t) => [t.transaction_id, t]));
    const modifiedById = new Map(updates.modified.map((t) => [t.transaction_id, t]));

    const existing = await prisma.transaction.findMany({
        where: {plaidTransactionId: {in: [...addedById.keys(), ...modifiedById.keys(), ...removedIds]}},
    });
    const existingIds = new Set(existing.map((t) => t.plaidTransactionId));

    const toDelete: string[] = [];
    const toUpdate: { id: string, data: { amount: number, date: Date, type: string, categoryId?: string } }[] = [];
    const toCreate: {
        userId: string, amount: number, description: string, date: Date, type: string,
        categoryId: string, plaidTransactionId: string, plaidItemId: string,
        categorizedBy: string | null, needsReview: boolean,
    }[] = [];

    for (const [plaidTransactionId, added] of addedById) {
        if (removedIds.has(plaidTransactionId) || existingIds.has(plaidTransactionId)) continue;
        const converted = convertPlaidTransaction(modifiedById.get(plaidTransactionId) ?? added);
        if (!converted) continue;
        toCreate.push({
            userId: item.userId,
            amount: converted.amount,
            description: converted.description,
            date: converted.date,
            type: converted.type,
            categoryId: categoryFor(converted.type, converted.categoryKey).id,
            plaidTransactionId,
            plaidItemId: item.id,
            categorizedBy: converted.categoryKey ? "plaid" : null,
            needsReview: !converted.categoryKey,
        });
    }

    // Transactions the user deleted are not brought back. Updates only touch bank-owned fields,
    // so the user's description and category edits are kept.
    for (const current of existing) {
        if (current.plaidItemId !== item.id) continue;
        const plaidTransactionId = current.plaidTransactionId!;
        const modified = modifiedById.get(plaidTransactionId);
        if (!removedIds.has(plaidTransactionId) && !modified) continue;

        const converted = modified && !removedIds.has(plaidTransactionId) ? convertPlaidTransaction(modified) : null;
        if (!converted) {
            toDelete.push(current.id);
            continue;
        }
        toUpdate.push({
            id: current.id,
            data: {
                amount: converted.amount,
                date: converted.date,
                type: converted.type,
                // A refund can flip the type, which needs a category of the new type
                ...(converted.type !== current.type && {categoryId: categoryFor(converted.type, converted.categoryKey).id}),
            },
        });
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Moving the cursor first locks the item row. If another sync of this item
            // already moved it, everything computed above is stale, so roll back.
            const claimed = await tx.plaidItem.updateMany({
                where: {id: item.id, cursor: item.cursor},
                data: {cursor: updates.cursor, lastSyncedAt: new Date(), error: null},
            });
            if (claimed.count === 0) {
                throw new ConcurrentSyncError();
            }
            if (toDelete.length > 0) {
                await tx.transaction.deleteMany({where: {id: {in: toDelete}}});
            }
            for (const {id, data} of toUpdate) {
                await tx.transaction.update({where: {id}, data});
            }
            if (toCreate.length > 0) {
                await tx.transaction.createMany({data: toCreate});
            }
        }, {maxWait: 10_000, timeout: 60_000});
    } catch (error) {
        // The other sync imported the same changes
        if (error instanceof ConcurrentSyncError) return result;
        throw error;
    }

    return {...result, added: toCreate.length, modified: toUpdate.length, removed: toDelete.length};
}
