import z from "zod";

const columnName = z.string().max(200);

export const ColumnMappingSchema = z.object({
    date: columnName,
    description: columnName,
    amount: columnName.optional(),
    debit: columnName.optional(),
    credit: columnName.optional(),
    direction: columnName.optional(),
    category: columnName.optional(),
    id: columnName.optional(),
    balance: columnName.optional(),
    invertSign: z.boolean().optional(),
    preset: z.enum(["chase-checking", "chase-card", "discover", "capital-one-bank", "capital-one-card", "venmo"]).optional(),
})

export const PlanRowSchema = z.object({
    fingerprint: z.string().min(1).max(191),
    date: z.string().datetime(),
    amount: z.number().refine((a) => a !== 0),
    description: z.string().max(191),
    status: z.enum(["new", "duplicate", "match", "transfer", "pair", "skip"]),
    include: z.boolean(),
    kind: z.enum(["income", "expense", "transfer"]),
    category: z.string().max(191).nullable(),
    suggestion: z.object({
        name: z.string().max(191),
        source: z.enum(["history", "bank", "keyword", "ai", "none"]),
        confidence: z.number().min(0).max(1).nullable(),
        alternatives: z.array(z.object({name: z.string().max(191), probability: z.number().min(0).max(1)})).max(10).nullable(),
    }).nullable(),
    transferAccountId: z.string().nullable(),
    linkTransactionId: z.string().nullable(),
    note: z.string().nullable(),
    memo: z.string().max(500).nullish(),
})

export const StatementBalanceSchema = z.object({
    date: z.string().datetime(),
    balance: z.number(),
})

export const CommitImportSchema = z.object({
    accountId: z.string().min(1),
    rows: z.array(PlanRowSchema).max(5000),
    mapping: ColumnMappingSchema.nullable(),
    // Balances the statement shows, saved as balance checks
    balances: z.array(StatementBalanceSchema).max(5000).default([]),
})

export type CommitImportSchemaType = z.input<typeof CommitImportSchema>;
