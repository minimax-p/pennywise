"use server";

import { CreateCategorySchema, CreateCategorySchemaType, DeleteCategorySchema, DeleteCategorySchemaType, EditCategorySchema, EditCategorySchemaType } from "@/schema/categories";
import { currentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";

export async function CreateCategory(form: CreateCategorySchemaType) {
    const parsedBody = CreateCategorySchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error("CreateCategorySchema: Invalid form data");
    }

    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }



    const { name, icon, type } = parsedBody.data;
    await assertCategoryNameAvailable(user.id, name, type);
    return prisma.category.create({
        data: {
            userId: user.id,
            name,
            icon,
            type,
            isUniversal: false
        }
    });
}

export async function DeleteCategory(form: DeleteCategorySchemaType) {
    const parsedBody = DeleteCategorySchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error("DeleteCategorySchema: Invalid form data");
    }

    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    const categoryToDelete = await prisma.category.findFirst({
        where: {
            userId: user.id,
            name: parsedBody.data.name,
            type: parsedBody.data.type,
            isUniversal: false
        }
    });

    if (!categoryToDelete) {
        throw new Error("Category not found or cannot be deleted");
    }

    const unsortedCategory = await GetOrCreateUnsortedCategory(parsedBody.data.type);

    // Its transactions and split shares move to Unsorted and wait on the Sort page
    const [, , deleted] = await prisma.$transaction([
        prisma.transaction.updateMany({
            where: {userId: user.id, categoryId: categoryToDelete.id},
            data: {categoryId: unsortedCategory.id, needsReview: true},
        }),
        prisma.transactionLine.updateMany({
            where: {categoryId: categoryToDelete.id},
            data: {categoryId: unsortedCategory.id},
        }),
        prisma.category.delete({where: {id: categoryToDelete.id}}),
    ]);
    return deleted;
}

export async function EditCategory(form: EditCategorySchemaType) {
    const parsedBody = EditCategorySchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error("EditCategorySchema: Invalid form data");
    }

    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    const { oldName, newName, icon, type } = parsedBody.data;

    const categoryToEdit = await prisma.category.findFirst({
        where: {
            userId: user.id,
            name: oldName,
            type: type,
            isUniversal: false
        }
    });

    if (!categoryToEdit) {
        throw new Error("Category not found or cannot be edited");
    }

    await assertCategoryNameAvailable(user.id, newName, type, categoryToEdit.id);

    // Update the category
    return prisma.category.update({
        where: {
            id: categoryToEdit.id
        },
        data: {
            name: newName,
            icon: icon
        }
    });
}

// Universal categories have no userId, so the database unique constraint does not cover
// them. Checking here keeps category names unambiguous for each user.
async function assertCategoryNameAvailable(userId: string, name: string, type: string, excludeId?: string) {
    const existing = await prisma.category.findFirst({
        where: {
            name,
            type,
            OR: [
                { userId },
                { isUniversal: true }
            ],
            ...(excludeId && { NOT: { id: excludeId } })
        }
    });
    if (existing) {
        throw new Error(`A ${type} category named "${name}" already exists`);
    }
}

async function GetOrCreateUnsortedCategory(type: string) {
    let unsortedCategory = await prisma.category.findFirst({
        where: {
            name: "Unsorted",
            type: type,
            isUniversal: true
        }
    });

    if (!unsortedCategory) {
        unsortedCategory = await prisma.category.create({
            data: {
                name: "Unsorted",
                icon: "❓",
                type: type,
                isUniversal: true
            }
        });
    }

    return unsortedCategory;
}

export async function GetCategories(type: string) {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    return prisma.category.findMany({
        where: {
            OR: [
                { userId: user.id },
                { isUniversal: true }
            ],
            type: type
        },
        orderBy: {
            name: 'asc'
        }
    });
}