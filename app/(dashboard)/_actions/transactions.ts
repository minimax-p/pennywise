"use server";

import {
    CreateTransactionSchema,
    CreateTransactionSchemaType,
    DeleteTransactionSchema,
    DeleteTransactionSchemaType,
    EditTransactionSchema,
    EditTransactionSchemaType
} from "@/schema/transaction";
import {currentUser} from "@clerk/nextjs/server";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";
import {applyHistoryChanges} from "@/lib/history";

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
        redirect("/sign-in");
    }

    const {amount, category, date, description, type} = parsedBody.data;

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
            }
        });
        await applyHistoryChanges(tx, user.id, [{date, type, amount}]);
    });
}

export async function EditTransaction(form: EditTransactionSchemaType) {
    const parsedBody = EditTransactionSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await currentUser();
    if (!user) {
        redirect("/sign-in");
    }

    const {id, amount, category, date, description} = parsedBody.data;

    const existing = await prisma.transaction.findFirst({where: {id, userId: user.id}});
    if (!existing) {
        throw new Error("Transaction not found");
    }

    const categoryRow = await findCategory(user.id, category, existing.type);
    if (!categoryRow) {
        throw new Error("Category not found");
    }

    await prisma.$transaction(async (tx) => {
        await tx.transaction.update({
            where: {id},
            data: {
                amount,
                date,
                description: description || "",
                categoryId: categoryRow.id,
            }
        });
        await applyHistoryChanges(tx, user.id, [
            {date: existing.date, type: existing.type, amount: -existing.amount},
            {date, type: existing.type, amount},
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
        redirect("/sign-in");
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
