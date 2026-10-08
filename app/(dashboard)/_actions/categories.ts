"use server";

import {ActionResult, requireUser} from "@/lib/actionResult";
import prisma from "@/lib/prisma";
import {CreateCategorySchema, CreateCategorySchemaType, MergeCategorySchema, UpdateCategorySchema, UpdateCategorySchemaType} from "@/schema/categories";
import {isSystemCategory} from "@/lib/categoryKeys";

// Pennywise has one user, so the built-in categories are yours to rename, regroup, hide or
// merge too. Only Transfer, Split, Adjustment and Unsorted stay as they are.

async function nameTaken(userId: string, name: string, type: string, excludeId?: string) {
    const existing = await prisma.category.findFirst({
        where: {
            name: {equals: name, mode: "insensitive"}, type, OR: [{userId}, {isUniversal: true}],
            ...(excludeId && {NOT: {id: excludeId}}),
        },
    });
    return existing ? `There's already a ${type === "income" ? "money in" : "spending"} category called ${existing.name}` : null;
}

// Yours to change: your own categories and the built-in ones, not the system ones
async function editable(userId: string, id: string) {
    const category = await prisma.category.findFirst({where: {id, OR: [{userId}, {isUniversal: true}]}});
    return category && !isSystemCategory(category) && (category.type === "income" || category.type === "expense") ? category : null;
}

// Throws on a bad form, for the quick "create" in the category picker
export async function CreateCategory(form: CreateCategorySchemaType) {
    const parsed = CreateCategorySchema.safeParse(form);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
    const user = await requireUser();
    const {name, icon, type, group} = parsed.data;
    const taken = await nameTaken(user.id, name, type);
    if (taken) throw new Error(taken);
    const last = await prisma.category.aggregate({_max: {sortOrder: true}});
    return prisma.category.create({
        data: {userId: user.id, name, icon, type, group, isUniversal: false, sortOrder: (last._max.sortOrder ?? 0) + 1},
    });
}

export async function UpdateCategory(form: UpdateCategorySchemaType): Promise<ActionResult<null>> {
    const parsed = UpdateCategorySchema.safeParse(form);
    if (!parsed.success) return {ok: false, error: parsed.error.issues[0]?.message ?? "Check the form"};
    const user = await requireUser();
    const {id, name, icon, group, hidden} = parsed.data;
    const category = await editable(user.id, id);
    if (!category) return {ok: false, error: "This category can't be changed"};
    const taken = await nameTaken(user.id, name, category.type, id);
    if (taken) return {ok: false, error: taken};
    await prisma.category.update({where: {id}, data: {name, icon, group, hidden}});
    return {ok: true, data: null};
}

// Everything in one category moves to another, and the first one goes away
export async function MergeCategory(form: { fromId: string, intoId: string }): Promise<ActionResult<{ moved: number }>> {
    const parsed = MergeCategorySchema.safeParse(form);
    if (!parsed.success || form.fromId === form.intoId) return {ok: false, error: "Pick another category"};
    const user = await requireUser();
    const from = await editable(user.id, parsed.data.fromId);
    const into = await prisma.category.findFirst({where: {id: parsed.data.intoId, OR: [{userId: user.id}, {isUniversal: true}]}});
    if (!from || !into) return {ok: false, error: "Category not found"};
    if (from.type !== into.type) return {ok: false, error: "Merge into a category of the same kind"};

    const moved = await prisma.$transaction(async (tx) => {
        const transactions = await tx.transaction.updateMany({where: {categoryId: from.id}, data: {categoryId: into.id}});
        await tx.transactionLine.updateMany({where: {categoryId: from.id}, data: {categoryId: into.id}});
        await tx.rule.updateMany({where: {categoryId: from.id}, data: {categoryId: into.id}});
        await tx.category.delete({where: {id: from.id}});
        return transactions.count;
    });
    return {ok: true, data: {moved}};
}
