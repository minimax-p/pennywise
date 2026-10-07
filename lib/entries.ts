import {Category, Prisma} from "@prisma/client";
import prisma from "@/lib/prisma";
import {CENT, roundMoney} from "@/lib/ledger";
import {payeeKey} from "@/lib/payee";
import {findOrCreatePerson} from "@/lib/people";
import {nameFields} from "@/lib/merchant";
import {categoryByKey} from "@/lib/categoryKeys";

// Saving money spent or received ("entries"), with an optional person and an optional
// split into your shares by category and other people's shares. Used by the Log sheet,
// the server actions and the iPhone shortcut.

type Db = Prisma.TransactionClient;

export type CategoryRef = { name: string, type: "income" | "expense" };
// An existing person, or a name for someone new
export type PersonRef = { id: string } | { name: string };

export type LineInput = {
    amount: number;
    category?: CategoryRef | null;
    person?: PersonRef | null;
};

export type EntryInput = {
    type: "income" | "expense";
    amount: number;
    date: Date;
    description: string;
    note: string | null;
    accountId: string | null;
    // Null leaves it Unsorted, waiting on the Sort page
    category: CategoryRef | null;
    // Who was on the other end
    person?: PersonRef | null;
    // A split; replaces the category
    lines?: LineInput[] | null;
    // manual, apple_pay, shortcut...
    source?: string;
};

export class EntryError extends Error {}

// The user's own category wins over a universal one with the same name
export async function findCategory(db: Db, userId: string, name: string, type: string): Promise<Category | undefined> {
    const categories = await db.category.findMany({where: {name, type, OR: [{userId}, {isUniversal: true}]}});
    return categories.find((c) => c.userId === userId) ?? categories[0];
}

export const getSplitCategory = (db: Db = prisma) => categoryByKey("split", db);
export const getUnsortedCategory = (db: Db, type: string) => categoryByKey(type === "income" ? "unsorted-income" : "unsorted-expense", db);

async function resolveCategory(db: Db, userId: string, entryType: string, ref: CategoryRef) {
    // Spending can't go in an income category; money in can be money back in a spending one
    if (entryType === "expense" && ref.type !== "expense") throw new EntryError("Pick a spending category");
    const category = await findCategory(db, userId, ref.name, ref.type);
    if (!category) throw new EntryError(`There is no category called ${ref.name}`);
    return category;
}

async function resolvePerson(db: Db, userId: string, ref: PersonRef) {
    if ("id" in ref) {
        const person = await db.person.findFirst({where: {id: ref.id, userId}});
        if (!person) throw new EntryError("Person not found");
        return person;
    }
    if (!ref.name.trim()) throw new EntryError("Type the person's name");
    return findOrCreatePerson(db, userId, ref.name);
}

// Checks a split and finds its categories and people
async function resolveLines(db: Db, userId: string, entry: EntryInput) {
    const lines = entry.lines ?? [];
    if (lines.length === 0) return null;
    for (const line of lines) {
        if (!(line.amount > 0)) throw new EntryError("Every part of a split needs an amount");
        if (Boolean(line.category) === Boolean(line.person)) throw new EntryError("Each part of a split is a category or a person");
    }
    const total = roundMoney(lines.reduce((sum, l) => sum + l.amount, 0));
    if (Math.abs(total - entry.amount) >= CENT) {
        throw new EntryError(`The parts add up to ${total.toFixed(2)}, not ${entry.amount.toFixed(2)}`);
    }
    const resolved = [];
    for (const [position, line] of lines.entries()) {
        resolved.push({
            amount: roundMoney(line.amount),
            position,
            categoryId: line.category ? (await resolveCategory(db, userId, entry.type, line.category)).id : null,
            personId: line.person ? (await resolvePerson(db, userId, line.person)).id : null,
        });
    }
    return resolved;
}

// Creates an entry, or replaces an existing one's fields when `id` is given
export async function saveEntry(userId: string, entry: EntryInput, id?: string, db?: Db) {
    const run = async (tx: Db) => {
        if (entry.accountId) {
            const account = await tx.account.findFirst({where: {id: entry.accountId, userId}});
            if (!account) throw new EntryError("Account not found");
        }
        const existing = id ? await tx.transaction.findFirst({where: {id, userId}}) : null;
        if (id && !existing) throw new EntryError("Transaction not found");
        if (existing?.type === "adjustment") throw new EntryError("Balance adjustments can only be deleted");

        const lines = await resolveLines(tx, userId, entry);
        // A split with only your own share is just a category
        const single = lines?.length === 1 && lines[0].categoryId ? lines[0] : null;
        const category = single
            ? await tx.category.findUniqueOrThrow({where: {id: single.categoryId!}})
            : lines ? await getSplitCategory(tx)
                : entry.category ? await resolveCategory(tx, userId, entry.type, entry.category)
                    : await getUnsortedCategory(tx, entry.type);
        // Left out when editing keeps the person already on it, like the Zelle sender
        const personId = entry.person === undefined
            ? existing?.personId ?? null
            : entry.person ? (await resolvePerson(tx, userId, entry.person)).id : null;

        const fields = {
            type: entry.type,
            amount: roundMoney(entry.amount),
            date: entry.date,
            ...nameFields(existing, entry.description),
            note: entry.note,
            accountId: entry.accountId,
            toAccountId: null,
            categoryId: category.id,
            personId,
            needsReview: category.name === "Unsorted",
            categorizedBy: category.name === "Unsorted" ? null : "you",
            categoryConfidence: null,
        };
        // Imported and Apple Pay entries keep the key from the bank's merchant name, so
        // renaming one ("Morning coffee") still teaches the category for that merchant
        const key = existing && existing.source !== "manual" && existing.payeeKey
            ? existing.payeeKey
            : entry.description ? payeeKey(entry.description) : null;

        const saved = existing
            ? await tx.transaction.update({where: {id: existing.id}, data: {...fields, payeeKey: key}})
            : await tx.transaction.create({data: {...fields, userId, payeeKey: key, source: entry.source ?? "manual"}});
        await tx.transactionLine.deleteMany({where: {transactionId: saved.id}});
        if (lines && !single) {
            await tx.transactionLine.createMany({data: lines.map((l) => ({...l, transactionId: saved.id}))});
        }
        return saved;
    };
    return db ? run(db) : prisma.$transaction(run);
}

// When the bank's amount differs from a logged split (a tip, say), the difference goes to
// your own share, or to the last share if the split is all other people's
export async function rebalanceLines(db: Db, transactionId: string, amount: number) {
    const lines = await db.transactionLine.findMany({where: {transactionId}, orderBy: {position: "asc"}});
    if (lines.length === 0) return;
    const transaction = await db.transaction.findUniqueOrThrow({where: {id: transactionId}});
    const difference = roundMoney(amount - lines.reduce((sum, l) => sum + l.amount, 0));
    if (Math.abs(difference) < CENT) return;
    const target = lines.find((l) => l.categoryId) ?? lines[lines.length - 1];
    const next = roundMoney(target.amount + difference);
    if (next > 0) {
        await db.transactionLine.update({where: {id: target.id}, data: {amount: next}});
    } else {
        // The bank's amount is smaller than the other shares: the split no longer fits
        await db.transactionLine.deleteMany({where: {transactionId}});
        const unsorted = await getUnsortedCategory(db, transaction.type);
        await db.transaction.update({where: {id: transactionId}, data: {categoryId: unsorted.id, needsReview: true}});
    }
}
