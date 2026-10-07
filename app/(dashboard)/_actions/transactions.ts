"use server";

import {
    CreateTransactionSchema,
    CreateTransactionSchemaType,
    CreateTransferSchema,
    CreateTransferSchemaType,
    DeleteTransactionSchema,
    DeleteTransactionSchemaType,
    EditTransactionSchema,
    EditTransactionSchemaType,
    SaveEntrySchema,
    SaveEntrySchemaType,
} from "@/schema/transaction";
import {ActionResult, requireUser} from "@/lib/actionResult";
import prisma from "@/lib/prisma";
import {assertOwnAccounts, getTransferCategory} from "@/lib/accounts";
import {EntryError, saveEntry} from "@/lib/entries";
import {nameFields} from "@/lib/merchant";

// Money spent or received, new or edited, with an optional person and split
export async function SaveEntry(form: SaveEntrySchemaType): Promise<ActionResult<{ id: string }>> {
    const parsed = SaveEntrySchema.safeParse(form);
    if (!parsed.success) return {ok: false, error: parsed.error.issues[0]?.message ?? "Check the form"};
    const user = await requireUser();
    const {id, ...entry} = parsed.data;
    try {
        const saved = await saveEntry(user.id, entry, id);
        return {ok: true, data: {id: saved.id}};
    } catch (error) {
        if (error instanceof EntryError) return {ok: false, error: error.message};
        throw error;
    }
}

export async function CreateTransaction(form: CreateTransactionSchemaType) {
    const parsedBody = CreateTransactionSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await requireUser();
    const {amount, category, categoryType, date, description, type, accountId, note} = parsedBody.data;
    await saveEntry(user.id, {
        type, amount, date, note,
        description: description || "",
        accountId: accountId || null,
        category: {name: category, type: categoryType ?? type},
    });
}

// Money moved between two of the user's accounts. Not counted as income or spending.
export async function CreateTransfer(form: CreateTransferSchemaType) {
    const parsedBody = CreateTransferSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await requireUser();

    const {amount, date, description, fromAccountId, toAccountId, note} = parsedBody.data;
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
            note,
        }
    });
}

// Can also change the type, e.g. turn an imported card payment into a transfer
export async function EditTransaction(form: EditTransactionSchemaType) {
    const parsedBody = EditTransactionSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await requireUser();

    const {id, type, amount, category, categoryType, date, description, accountId, toAccountId, note} = parsedBody.data;
    const existing = await prisma.transaction.findFirst({where: {id, userId: user.id}});
    if (!existing) {
        throw new Error("Transaction not found");
    }
    if (existing.type === "adjustment") {
        throw new Error("Balance adjustments can only be deleted");
    }

    if (type !== "transfer") {
        await saveEntry(user.id, {
            type, amount, date, note,
            description: description || "",
            accountId: accountId || null,
            category: {name: category!, type: categoryType ?? type},
        }, id);
        return;
    }

    await assertOwnAccounts(user.id, [accountId, toAccountId]);
    const transferCategory = await getTransferCategory();
    await prisma.$transaction([
        prisma.transactionLine.deleteMany({where: {transactionId: id}}),
        prisma.transaction.update({
            where: {id},
            data: {
                type,
                amount,
                date,
                ...nameFields(existing, description || ""),
                categoryId: transferCategory.id,
                accountId: accountId || null,
                toAccountId,
                payeeKey: null,
                personId: null,
                categorizedBy: null,
                needsReview: false,
                categoryConfidence: null,
                note,
            }
        }),
    ]);
}

export async function DeleteTransaction(form: DeleteTransactionSchemaType) {
    const parsedBody = DeleteTransactionSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await requireUser();

    const existing = await prisma.transaction.findFirst({where: {id: parsedBody.data.id, userId: user.id}});
    if (!existing) {
        throw new Error("Transaction not found");
    }

    await prisma.transaction.delete({where: {id: existing.id}});
}
