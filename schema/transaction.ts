import z from "zod";

const amount = z.coerce.number().positive().multipleOf(0.01);
const note = z.string().trim().max(500).nullish().transform((v) => v || null);
// The category's own type when it differs from the money's direction: money back
// filed under a spending category is a refund and lowers that spending
const categoryType = z.enum(["income", "expense"]).optional();

export const CreateTransactionSchema = z.object({
    amount,
    description: z.string().optional(),
    date: z.coerce.date(),
    category: z.string(),
    categoryType,
    type: z.union([
        z.literal("income"),
        z.literal("expense"),
    ]),
    accountId: z.string().nullish(),
    note,
})

export type CreateTransactionSchemaType = z.input<typeof CreateTransactionSchema>;

export const CreateTransferSchema = z.object({
    amount,
    description: z.string().optional(),
    date: z.coerce.date(),
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    note,
}).refine((t) => t.fromAccountId !== t.toAccountId, {
    message: "Pick two different accounts",
    path: ["toAccountId"],
})

export type CreateTransferSchemaType = z.input<typeof CreateTransferSchema>;

export const EditTransactionSchema = z.object({
    id: z.string().min(1),
    type: z.enum(["income", "expense", "transfer"]),
    amount,
    description: z.string().optional(),
    date: z.coerce.date(),
    // Required unless it is a transfer
    category: z.string().optional(),
    categoryType,
    // For transfers, the account the money came from
    accountId: z.string().nullish(),
    // Transfers only
    toAccountId: z.string().nullish(),
    note,
}).superRefine((t, ctx) => {
    if (t.type === "transfer") {
        if (!t.accountId) ctx.addIssue({code: "custom", message: "Pick the account the money came from", path: ["accountId"]});
        if (!t.toAccountId) ctx.addIssue({code: "custom", message: "Pick the account the money went to", path: ["toAccountId"]});
        if (t.accountId && t.accountId === t.toAccountId) ctx.addIssue({code: "custom", message: "Pick two different accounts", path: ["toAccountId"]});
    } else if (!t.category) {
        ctx.addIssue({code: "custom", message: "Pick a category", path: ["category"]});
    }
})

export type EditTransactionSchemaType = z.input<typeof EditTransactionSchema>;

export const DeleteTransactionSchema = z.object({
    id: z.string().min(1),
})

export type DeleteTransactionSchemaType = z.infer<typeof DeleteTransactionSchema>;
