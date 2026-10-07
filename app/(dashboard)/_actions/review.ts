"use server";

import {ActionResult, requireUser} from "@/lib/actionResult";
import z from "zod";
import prisma from "@/lib/prisma";
import {jevEnabled} from "@/lib/categorize/jev";
import {categorizationFields, suggestCategories} from "@/lib/categorize/suggest";
import {findCategory, getSplitCategory} from "@/lib/entries";
import {categoryFits} from "@/lib/rules";
import {merchantName} from "@/lib/merchant";
import {getTransferCategory} from "@/lib/accounts";
import {remember, restore} from "@/lib/sortUndo";

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
            personId: t.personId,
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
        await prisma.transaction.update({
            where: {id: transaction.id},
            data: {categoryId: category.id, ...fields, ...(suggestion.rename ? {merchant: suggestion.rename} : {})},
        });
        if (fields.needsReview) suggested++;
        else sorted++;
    }

    const left = await prisma.transaction.count({where: {userId: user.id, needsReview: true, type: {in: ["income", "expense"]}}});
    return {ok: true, data: {sorted, suggested, left}};
}

const IdsSchema = z.array(z.string().min(1)).min(1).max(500);

const SortGroupSchema = z.object({
    ids: IdsSchema,
    category: z.string().min(1).max(191),
    categoryType: z.enum(["income", "expense"]).optional(),
    // Also make a rule, so this merchant or person is filed like this from now on
    always: z.boolean().default(false),
});

type Sorted = { sorted: number, undo: string, rule: string | null };

// Files a Sort card (a merchant's or person's waiting transactions) under one category
export async function SortGroup(form: z.input<typeof SortGroupSchema>): Promise<ActionResult<Sorted>> {
    const parsed = SortGroupSchema.safeParse(form);
    if (!parsed.success) return {ok: false, error: "Invalid request"};
    const user = await requireUser();
    const {ids, category, categoryType, always} = parsed.data;

    const transactions = await prisma.transaction.findMany({
        where: {id: {in: ids}, userId: user.id, type: {in: ["income", "expense"]}},
        include: {person: true},
    });
    if (transactions.length === 0) return {ok: false, error: "Transaction not found"};
    const type = transactions[0].type;
    const categoryRow = await findCategory(prisma, user.id, category, categoryType ?? type);
    if (!categoryRow) return {ok: false, error: "Category not found"};
    if (transactions.some((t) => !categoryFits(t.type, categoryRow.type))) return {ok: false, error: "Pick a spending category"};

    return prisma.$transaction(async (tx) => {
        const undo = await remember(tx, user.id, transactions.map((t) => t.id));
        await tx.transactionLine.deleteMany({where: {transactionId: {in: transactions.map((t) => t.id)}}});
        await tx.transaction.updateMany({
            where: {id: {in: transactions.map((t) => t.id)}},
            data: {categoryId: categoryRow.id, categorizedBy: "you", needsReview: categoryRow.name === "Unsorted", categoryConfidence: null},
        });
        let rule: string | null = null;
        const first = transactions[0];
        if (always && (first.personId || first.payeeKey)) {
            const match = first.personId
                ? {kind: "person", personId: first.personId, direction: type}
                : {kind: "merchant", pattern: first.payeeKey, direction: type};
            // A merchant or person already with a rule gets the new category
            const existing = await tx.rule.findFirst({where: {userId: user.id, ...match}});
            if (existing) {
                rule = (await tx.rule.update({where: {id: existing.id}, data: {categoryId: categoryRow.id}})).label;
            } else {
                const created = await tx.rule.create({
                    data: {...match, userId: user.id, categoryId: categoryRow.id, label: first.person?.name ?? merchantName(first)},
                });
                undo.withRule(created.id);
                rule = created.label;
            }
        }
        return {ok: true as const, data: {sorted: transactions.length, undo: undo.token, rule}};
    });
}

// Money from someone who owes you: it settles their share instead of counting as income
export async function MarkPaidBack(form: { ids: string[] }): Promise<ActionResult<Sorted>> {
    const parsed = IdsSchema.safeParse(form.ids);
    if (!parsed.success) return {ok: false, error: "Invalid request"};
    const user = await requireUser();
    const transactions = await prisma.transaction.findMany({
        where: {id: {in: parsed.data}, userId: user.id, type: "income", personId: {not: null}},
    });
    if (transactions.length === 0) return {ok: false, error: "Only money from a person can be paid back"};
    return prisma.$transaction(async (tx) => {
        const undo = await remember(tx, user.id, transactions.map((t) => t.id));
        const split = await getSplitCategory(tx);
        for (const t of transactions) {
            await tx.transactionLine.deleteMany({where: {transactionId: t.id}});
            await tx.transactionLine.create({data: {transactionId: t.id, amount: t.amount, personId: t.personId}});
            await tx.transaction.update({
                where: {id: t.id},
                data: {categoryId: split.id, categorizedBy: "you", needsReview: false, categoryConfidence: null},
            });
        }
        return {ok: true as const, data: {sorted: transactions.length, undo: undo.token, rule: null}};
    });
}

// An ATM withdrawal, card payment or the like that was filed as spending or income becomes a
// move between your accounts
export async function MakeTransfer(form: { ids: string[], accountId: string }): Promise<ActionResult<Sorted>> {
    const parsed = z.object({ids: IdsSchema, accountId: z.string().min(1)}).safeParse(form);
    if (!parsed.success) return {ok: false, error: "Invalid request"};
    const user = await requireUser();
    const other = await prisma.account.findFirst({where: {id: parsed.data.accountId, userId: user.id}});
    if (!other) return {ok: false, error: "Account not found"};
    const transactions = await prisma.transaction.findMany({
        where: {id: {in: parsed.data.ids}, userId: user.id, type: {in: ["income", "expense"]}, accountId: {not: null}},
    });
    if (transactions.length === 0 || transactions.some((t) => t.accountId === other.id)) return {ok: false, error: "Pick another account"};
    return prisma.$transaction(async (tx) => {
        const undo = await remember(tx, user.id, transactions.map((t) => t.id));
        const transfer = await getTransferCategory(tx);
        for (const t of transactions) {
            await tx.transactionLine.deleteMany({where: {transactionId: t.id}});
            await tx.transaction.update({
                where: {id: t.id},
                data: {
                    type: "transfer", categoryId: transfer.id, payeeKey: null, personId: null,
                    accountId: t.type === "expense" ? t.accountId : other.id,
                    toAccountId: t.type === "expense" ? other.id : t.accountId,
                    needsReview: false, categorizedBy: null, categoryConfidence: null,
                },
            });
        }
        return {ok: true as const, data: {sorted: transactions.length, undo: undo.token, rule: null}};
    });
}

export async function UndoSort(token: string): Promise<ActionResult<null>> {
    const user = await requireUser();
    const restored = await prisma.$transaction((tx) => restore(tx, user.id, token));
    return restored ? {ok: true, data: null} : {ok: false, error: "Too late to undo that one"};
}

// Something Pennywise filed by itself was wrong: back to the Sort page
export async function ReturnToSort(id: string): Promise<ActionResult<null>> {
    const user = await requireUser();
    const result = await prisma.transaction.updateMany({
        where: {id, userId: user.id, type: {in: ["income", "expense"]}},
        data: {needsReview: true},
    });
    return result.count ? {ok: true, data: null} : {ok: false, error: "Transaction not found"};
}
