"use server";

import {ActionResult, requireUser} from "@/lib/actionResult";
import z from "zod";
import prisma from "@/lib/prisma";
import {jevEnabled} from "@/lib/categorize/jev";
import {categorizationFields, suggestCategories} from "@/lib/categorize/suggest";

const SortSchema = z.object({
    id: z.string().min(1),
    category: z.string().min(1).max(191),
    // The category's type when it differs from the money's direction: money back in a
    // spending category is a refund
    categoryType: z.enum(["income", "expense"]).optional(),
    // Also sort the other waiting transactions from the same merchant
    applyToMerchant: z.boolean(),
});

export async function SortTransaction(form: z.input<typeof SortSchema>): Promise<ActionResult<{ sorted: number }>> {
    const parsed = SortSchema.safeParse(form);
    if (!parsed.success) return {ok: false, error: "Invalid request"};
    const user = await requireUser();
    const {id, category, categoryType, applyToMerchant} = parsed.data;

    const transaction = await prisma.transaction.findFirst({where: {id, userId: user.id, type: {in: ["income", "expense"]}}});
    if (!transaction) return {ok: false, error: "Transaction not found"};

    const categories = await prisma.category.findMany({
        where: {name: category, type: categoryType ?? transaction.type, OR: [{userId: user.id}, {isUniversal: true}]},
    });
    const categoryRow = categories.find((c) => c.userId === user.id) ?? categories[0];
    if (!categoryRow) return {ok: false, error: "Category not found"};
    // Spending can't go in an income category
    if (transaction.type === "expense" && categoryRow.type !== "expense") return {ok: false, error: "Pick a spending category"};

    const sorted = {categoryId: categoryRow.id, categorizedBy: "you", needsReview: categoryRow.name === "Unsorted", categoryConfidence: null};
    await prisma.transaction.update({where: {id}, data: sorted});

    let others = 0;
    if (applyToMerchant && transaction.payeeKey) {
        const result = await prisma.transaction.updateMany({
            where: {userId: user.id, payeeKey: transaction.payeeKey, type: transaction.type, needsReview: true, NOT: {id}},
            data: {...sorted, categorizedBy: "history"},
        });
        others = result.count;
    }

    return {ok: true, data: {sorted: 1 + others}};
}

const AcceptSchema = z.object({ids: z.array(z.string().min(1)).max(500)});

// Keeps the suggested category of each transaction that has one
export async function AcceptSuggestions(form: z.infer<typeof AcceptSchema>): Promise<ActionResult<{ accepted: number }>> {
    const parsed = AcceptSchema.safeParse(form);
    if (!parsed.success) return {ok: false, error: "Invalid request"};
    const user = await requireUser();

    const result = await prisma.transaction.updateMany({
        where: {
            id: {in: parsed.data.ids}, userId: user.id, needsReview: true,
            type: {in: ["income", "expense"]}, NOT: {category: {name: "Unsorted"}},
        },
        data: {needsReview: false, categorizedBy: "you", categoryConfidence: null},
    });
    return {ok: true, data: {accepted: result.count}};
}

const ASK_AI_LIMIT = 300;

// Fills in categories for waiting transactions from your history and Jev
export async function AskAiToSort(): Promise<ActionResult<{ sorted: number, suggested: number, left: number }>> {
    const user = await requireUser();
    if (!jevEnabled()) {
        return {ok: false, error: "AI sorting is off. Add TYPESAFE_API_KEY to the server's .env to turn it on."};
    }

    const waiting = await prisma.transaction.findMany({
        where: {userId: user.id, needsReview: true, type: {in: ["income", "expense"]}},
        include: {account: {select: {name: true, type: true}}},
        orderBy: {date: "desc"},
        take: ASK_AI_LIMIT,
    });

    const suggestions = await suggestCategories(
        user.id,
        waiting.map((t) => ({
            description: t.description,
            amount: t.type === "income" ? t.amount : -t.amount,
            date: t.date,
            bankCategory: null,
            accountName: t.account?.name ?? null,
            accountType: t.account?.type ?? null,
        })),
        // Jev already answered these once
        (i) => waiting[i].categorizedBy !== "ai",
    );

    const categories = await prisma.category.findMany({
        where: {OR: [{userId: user.id}, {isUniversal: true}], type: {in: ["income", "expense"]}},
    });
    let sorted = 0;
    let suggested = 0;
    for (const [i, transaction] of waiting.entries()) {
        const suggestion = suggestions[i];
        if (suggestion.source === "none") continue;
        const category = categories.find((c) => c.type === transaction.type && c.name === suggestion.name && c.userId === user.id)
            ?? categories.find((c) => c.type === transaction.type && c.name === suggestion.name);
        if (!category) continue;
        const fields = categorizationFields(suggestion);
        await prisma.transaction.update({where: {id: transaction.id}, data: {categoryId: category.id, ...fields}});
        if (fields.needsReview) suggested++;
        else sorted++;
    }

    const left = await prisma.transaction.count({where: {userId: user.id, needsReview: true, type: {in: ["income", "expense"]}}});
    return {ok: true, data: {sorted, suggested, left}};
}
