"use server";

import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import prisma from "@/lib/prisma";
import {UpdateSelfNamesSchema} from "@/schema/userSettings";
import {getTransferCategory} from "@/lib/accounts";
import {selfTransferAccount} from "@/lib/import/plan";
import {parseSelfNames} from "@/lib/import/zelle";

type ActionResult<T> = { ok: true, data: T } | { ok: false, error: string };

// Zelle payments to or from these names are imported as moves between your own accounts
export async function UpdateSelfNames(selfNames: string): Promise<ActionResult<string | null>> {
    const parsed = UpdateSelfNamesSchema.safeParse({selfNames});
    if (!parsed.success) return {ok: false, error: "Keep it under 191 characters"};
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }
    const settings = await prisma.userSettings.upsert({
        where: {userId: user.id},
        create: {userId: user.id, currency: "USD", selfNames: parsed.data.selfNames},
        update: {selfNames: parsed.data.selfNames},
    });
    return {ok: true, data: settings.selfNames};
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Zelle payments to or from yourself that were saved as spending or income, for example
// imported before your name was set, become transfers. Ones whose other account can't be
// told, or whose other side is already a transaction there, are left for you to fix.
export async function ConvertSelfZelle(dryRun: boolean): Promise<ActionResult<{ converted: number, skipped: number }>> {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }
    const settings = await prisma.userSettings.findUnique({where: {userId: user.id}});
    const selfNames = parseSelfNames(settings?.selfNames);
    if (selfNames.length === 0) return {ok: false, error: "Add your name first"};

    const accounts = await prisma.account.findMany({where: {userId: user.id}});
    const candidates = await prisma.transaction.findMany({
        where: {userId: user.id, type: {in: ["income", "expense"]}, accountId: {not: null}, description: {contains: "zelle"}},
    });
    const conversions: { id: string, from: string, to: string }[] = [];
    let skipped = 0;
    for (const t of candidates) {
        const account = accounts.find((a) => a.id === t.accountId);
        if (!account) continue;
        const others = accounts.filter((a) => a.id !== account.id && !a.archived);
        const other = selfTransferAccount(t, account, others, selfNames);
        if (other === undefined) continue;
        // The other side already saved in the other account would count the money twice
        const mirror = other && await prisma.transaction.findFirst({
            where: {
                userId: user.id, accountId: other.id, type: t.type === "expense" ? "income" : "expense",
                amount: {gte: t.amount - 0.005, lte: t.amount + 0.005},
                date: {gte: new Date(t.date.getTime() - 5 * DAY_MS), lte: new Date(t.date.getTime() + 5 * DAY_MS)},
            },
        });
        if (!other || mirror) {
            skipped++;
            continue;
        }
        conversions.push(t.type === "expense" ? {id: t.id, from: account.id, to: other.id} : {id: t.id, from: other.id, to: account.id});
    }
    if (!dryRun && conversions.length > 0) {
        const transfer = await getTransferCategory();
        await prisma.$transaction(conversions.map((c) => prisma.transaction.update({
            where: {id: c.id},
            data: {
                type: "transfer", categoryId: transfer.id, accountId: c.from, toAccountId: c.to,
                payeeKey: null, needsReview: false, categorizedBy: null, categoryConfidence: null,
            },
        })));
    }
    return {ok: true, data: {converted: conversions.length, skipped}};
}
