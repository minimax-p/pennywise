"use server";

import {ActionResult, requireUser} from "@/lib/actionResult";
import prisma from "@/lib/prisma";
import {CATEGORIES} from "@/prisma/categories.mjs";

export type StartOverScope = "transactions" | "everything";

// Wipes your data so you can import again from scratch. "transactions" keeps your accounts
// (with the balances you entered), categories, rules, people and shortcuts; "everything" goes
// back to a fresh install. The server's nightly backups are the only way back.
export async function StartOver(scope: StartOverScope, confirm: string): Promise<ActionResult<{ transactions: number }>> {
    if (confirm.trim().toUpperCase() !== "DELETE") return {ok: false, error: "Type DELETE to confirm"};
    if (scope !== "transactions" && scope !== "everything") return {ok: false, error: "Invalid request"};
    const user = await requireUser();
    const userId = user.id;

    const deleted = await prisma.$transaction(async (tx) => {
        await tx.importedRow.deleteMany({where: {account: {userId}}});
        // Split parts go with their transactions
        const transactions = await tx.transaction.deleteMany({where: {userId}});
        // Balances read from statements go with the statements; the ones you typed stay
        await tx.balanceCheck.deleteMany({where: {account: {userId}, ...(scope === "transactions" ? {source: "statement"} : {})}});
        if (scope === "everything") {
            await tx.rule.deleteMany({where: {userId}});
            await tx.person.deleteMany({where: {userId}});
            await tx.account.deleteMany({where: {userId}});
            await tx.category.deleteMany({where: {userId}});
            await tx.captureToken.deleteMany({where: {userId}});
            await tx.plaidItem.deleteMany({where: {userId}});
            await tx.userSettings.deleteMany({where: {userId}});
            // The built-in categories as they first were
            await tx.category.deleteMany({where: {isUniversal: true, key: null}});
            for (const {key, name, icon, group, sortOrder} of CATEGORIES) {
                await tx.category.updateMany({where: {key}, data: {name, icon, group, sortOrder, hidden: false}});
            }
        }
        return transactions.count;
    }, {timeout: 120_000});
    return {ok: true, data: {transactions: deleted}};
}
