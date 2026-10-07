import {Prisma} from "@prisma/client";
import prisma from "@/lib/prisma";
import {roundMoney} from "@/lib/ledger";
import {isSelf, parseSelfNames, parseZelle} from "@/lib/import/zelle";

// People you send money to and get money from, and what they owe you.
//
// What someone owes you is the sum of their shares in split transactions: their share of
// money you paid out counts up (you covered them), their share of money you got counts
// down (they paid you back). Negative means you owe them.

type Db = Prisma.TransactionClient;

// The form aliases are kept in: "Alex  Nguyen" and "ALEX NGUYEN" are both "ALEX NGUYEN"
export function aliasOf(name: string) {
    return name.toUpperCase().replace(/[^\p{L}\p{N}'-]+/gu, " ").trim();
}

// Banks print names in capitals; "ALEX NGUYEN" reads better as "Alex Nguyen". Names typed
// in mixed case are kept as they are.
export function displayName(raw: string) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (name !== name.toUpperCase() && name !== name.toLowerCase()) return name;
    return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toUpperCase());
}

export async function findPerson(db: Db, userId: string, raw: string) {
    const alias = aliasOf(raw);
    if (!alias) return null;
    return db.person.findFirst({
        where: {userId, OR: [{aliases: {has: alias}}, {name: {equals: displayName(raw), mode: "insensitive"}}]},
    });
}

// The person a name on a bank line, or typed in, refers to. New names become new people.
export async function findOrCreatePerson(db: Db, userId: string, raw: string) {
    const existing = await findPerson(db, userId, raw);
    if (existing) {
        const alias = aliasOf(raw);
        if (!existing.aliases.includes(alias)) {
            return db.person.update({where: {id: existing.id}, data: {aliases: {push: alias}}});
        }
        return existing;
    }
    const name = displayName(raw).slice(0, 80);
    // Two different people can share a name; the second one gets a number
    let candidate = name;
    for (let n = 2; await db.person.findUnique({where: {userId_name: {userId, name: candidate}}}); n++) {
        candidate = `${name} ${n}`;
    }
    return db.person.create({data: {userId, name: candidate, aliases: [aliasOf(raw)]}});
}

// What each person owes you, by person id; negative when you owe them
export async function personBalances(userId: string, db: Db = prisma): Promise<Map<string, number>> {
    const lines = await db.transactionLine.findMany({
        where: {personId: {not: null}, transaction: {userId}},
        select: {personId: true, amount: true, transaction: {select: {type: true}}},
    });
    const balances = new Map<string, number>();
    for (const line of lines) {
        const sign = line.transaction.type === "expense" ? 1 : line.transaction.type === "income" ? -1 : 0;
        balances.set(line.personId!, (balances.get(line.personId!) ?? 0) + sign * line.amount);
    }
    for (const [id, balance] of balances) balances.set(id, roundMoney(balance));
    return balances;
}

// Owed to you and what you owe, over everyone
export function owedTotals(balances: Map<string, number>) {
    let owedToYou = 0, youOwe = 0;
    for (const balance of balances.values()) {
        if (balance > 0) owedToYou += balance;
        else youOwe -= balance;
    }
    return {owedToYou: roundMoney(owedToYou), youOwe: roundMoney(youOwe), net: roundMoney(owedToYou - youOwe)};
}

// Links Zelle payments saved before people were tracked to the person on the line.
// Payments to or from yourself are left alone.
export async function linkZellePeople(userId: string) {
    const unlinked = await prisma.transaction.findMany({
        where: {userId, personId: null, type: {in: ["income", "expense"]}, description: {contains: "zelle", mode: "insensitive"}},
        select: {id: true, description: true},
    });
    if (unlinked.length === 0) return 0;
    const settings = await prisma.userSettings.findUnique({where: {userId}});
    const selfNames = parseSelfNames(settings?.selfNames);
    let linked = 0;
    for (const transaction of unlinked) {
        const zelle = parseZelle(transaction.description);
        if (!zelle || isSelf(zelle.name, selfNames)) continue;
        await prisma.$transaction(async (tx) => {
            const person = await findOrCreatePerson(tx, userId, zelle.name);
            await tx.transaction.update({where: {id: transaction.id}, data: {personId: person.id}});
        });
        linked++;
    }
    return linked;
}
