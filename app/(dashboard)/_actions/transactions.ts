"use server";

import {
    CreateTransactionSchema,
    CreateTransactionSchemaType,
    CreateTransferSchema,
    CreateTransferSchemaType,
    DeleteTransactionSchema,
    DeleteTransactionSchemaType,
    EditTransactionSchema,
    EditTransactionSchemaType
} from "@/schema/transaction";
import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";
import {applyHistoryChanges} from "@/lib/history";
import {assertOwnAccounts, getTransferCategory} from "@/lib/accounts";
import {payeeKey} from "@/lib/payee";

// The user's own category wins over a universal one with the same name
async function findCategory(userId: string, name: string, type: string) {
    const categories = await prisma.category.findMany({
        where: {
            name,
            type,
            OR: [
                { userId },
                { isUniversal: true }
            ]
        }
    });
    return categories.find((c) => c.userId === userId) ?? categories[0];
}

export async function CreateTransaction(form: CreateTransactionSchemaType) {
    const parsedBody = CreateTransactionSchema.safeParse(form);
    if(!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await currentUser();
    if(!user) {
        redirect("/login");
    }

    const {amount, category, date, description, type, accountId} = parsedBody.data;
    await assertOwnAccounts(user.id, [accountId]);

    const categoryRow = await findCategory(user.id, category, type);
    if (!categoryRow) {
        throw new Error("Category not found");
    }

    await prisma.$transaction(async (tx) => {
        await tx.transaction.create({
            data:{
                userId: user.id,
                amount,
                description: description || "",
                date,
                type,
                categoryId: categoryRow.id,
                accountId: accountId || null,
                payeeKey: description ? payeeKey(description) : null,
            }
        });
        await applyHistoryChanges(tx, user.id, [{date, type, amount}]);
    });
}

// Money moved between two of the user's accounts. Not counted as income or spending.
export async function CreateTransfer(form: CreateTransferSchemaType) {
    const parsedBody = CreateTransferSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await currentUser();
    if (!user) {
        redirect("/login");
    }

    const {amount, date, description, fromAccountId, toAccountId} = parsedBody.data;
    await assertOwnAccounts(user.id, [fromAccountId, toAccountId]);
    const category = await getTransferCategory();

    await prisma.transaction.create({
        data: {
            userId: user.id,
            amount,
            description: description || "",
            date,
            type: "transfer",
            categoryId: category.id,
            accountId: fromAccountId,
            toAccountId,
        }
    });
}

// Imported and Apple Pay transactions keep the key from the bank's merchant name, so
// renaming one ("Morning coffee") still teaches the category for that merchant
function editedPayeeKey(existing: { source: string, payeeKey: string | null }, description?: string) {
    if (existing.source !== "manual" && existing.payeeKey) return existing.payeeKey;
    return description ? payeeKey(description) : null;
}

// Can also change the type, e.g. turn an imported card payment into a transfer
export async function EditTransaction(form: EditTransactionSchemaType) {
    const parsedBody = EditTransactionSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await currentUser();
    if (!user) {
        redirect("/login");
    }

    const {id, type, amount, category, date, description, accountId, toAccountId} = parsedBody.data;

    const existing = await prisma.transaction.findFirst({where: {id, userId: user.id}});
    if (!existing) {
        throw new Error("Transaction not found");
    }
    await assertOwnAccounts(user.id, [accountId, toAccountId]);

    const categoryRow = type === "transfer"
        ? await getTransferCategory()
        : await findCategory(user.id, category!, type);
    if (!categoryRow) {
        throw new Error("Category not found");
    }

    await prisma.$transaction(async (tx) => {
        await tx.transaction.update({
            where: {id},
            data: {
                type,
                amount,
                date,
                description: description || "",
                categoryId: categoryRow.id,
                accountId: accountId || null,
                toAccountId: type === "transfer" ? toAccountId : null,
                payeeKey: type === "transfer" ? null : editedPayeeKey(existing, description),
            }
        });
        await applyHistoryChanges(tx, user.id, [
            {date: existing.date, type: existing.type, amount: -existing.amount},
            {date, type, amount},
        ]);
    });
}

export async function DeleteTransaction(form: DeleteTransactionSchemaType) {
    const parsedBody = DeleteTransactionSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await currentUser();
    if (!user) {
        redirect("/login");
    }

    const existing = await prisma.transaction.findFirst({where: {id: parsedBody.data.id, userId: user.id}});
    if (!existing) {
        throw new Error("Transaction not found");
    }

    await prisma.$transaction(async (tx) => {
        await tx.transaction.delete({where: {id: existing.id}});
        await applyHistoryChanges(tx, user.id, [
            {date: existing.date, type: existing.type, amount: -existing.amount},
        ]);
    });
}
