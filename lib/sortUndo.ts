import {randomUUID} from "node:crypto";
import {Prisma} from "@prisma/client";

// Undo for the Sort page: before a card is filed, the transactions it changes are copied
// here, and Undo puts them back. Kept in memory for a while; a restart forgets them.

type Db = Prisma.TransactionClient;

const fields = {
    id: true, type: true, categoryId: true, needsReview: true, categorizedBy: true, categoryConfidence: true,
    accountId: true, toAccountId: true, payeeKey: true, personId: true, merchant: true,
    lines: {select: {amount: true, categoryId: true, personId: true, position: true}},
} satisfies Prisma.TransactionSelect;

type Snapshot = Prisma.TransactionGetPayload<{ select: typeof fields }>;
type Entry = { userId: string, snapshots: Snapshot[], ruleId: string | null, at: number };

const KEEP_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 200;
const entries = new Map<string, Entry>();

export async function remember(db: Db, userId: string, ids: string[]) {
    const snapshots = await db.transaction.findMany({where: {id: {in: ids}, userId}, select: fields});
    const now = Date.now();
    for (const [token, entry] of entries) {
        if (now - entry.at > KEEP_MS) entries.delete(token);
    }
    while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    const token = randomUUID();
    entries.set(token, {userId, snapshots, ruleId: null, at: now});
    return {
        token,
        // A rule made by the same tap is removed by its undo too
        withRule: (ruleId: string) => {
            const entry = entries.get(token);
            if (entry) entry.ruleId = ruleId;
        },
    };
}

// Puts the transactions back as they were; false when the undo has expired
export async function restore(db: Db, userId: string, token: string) {
    const entry = entries.get(token);
    if (!entry || entry.userId !== userId) return false;
    entries.delete(token);
    for (const {id, lines, ...data} of entry.snapshots) {
        const exists = await db.transaction.findFirst({where: {id, userId}, select: {id: true}});
        if (!exists) continue;
        await db.transactionLine.deleteMany({where: {transactionId: id}});
        await db.transaction.update({where: {id}, data});
        if (lines.length > 0) await db.transactionLine.createMany({data: lines.map((l) => ({...l, transactionId: id}))});
    }
    if (entry.ruleId) await db.rule.deleteMany({where: {id: entry.ruleId, userId}});
    return true;
}
