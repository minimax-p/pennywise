import z from "zod";
import {ACCOUNT_TYPES} from "@/lib/types";

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

// CDs only; empty means not set
const cdFields = {
    apy: z.coerce.number().min(0).max(100).nullish().transform((v) => v ?? null),
    maturesOn: z.coerce.date().nullish().transform((v) => v ?? null),
};

export const CreateAccountSchema = z.object({
    name: z.string().trim().min(1).max(40),
    type: z.enum(ACCOUNT_TYPES),
    institution: optionalText(60),
    walletCardName: optionalText(80),
    ...cdFields,
    // Current balance; negative for money owed on a credit card
    balance: z.coerce.number(),
    balanceDate: z.coerce.date(),
})

export type CreateAccountSchemaType = z.input<typeof CreateAccountSchema>;

export const EditAccountSchema = z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(40),
    type: z.enum(ACCOUNT_TYPES),
    institution: optionalText(60),
    walletCardName: optionalText(80),
    ...cdFields,
    archived: z.boolean(),
})

export type EditAccountSchemaType = z.input<typeof EditAccountSchema>;

export const CheckBalanceSchema = z.object({
    accountId: z.string().min(1),
    // What the bank shows; negative for money owed on a credit card
    balance: z.coerce.number().multipleOf(0.01),
    // When it was true, see BalanceDateFromDay
    balanceDate: z.coerce.date(),
    // False only compares; true also saves the check
    save: z.boolean(),
    // When saving a check that doesn't match: also add an adjustment for the difference
    adjust: z.boolean().default(false),
})

export type CheckBalanceSchemaType = z.input<typeof CheckBalanceSchema>;

export const DeleteBalanceCheckSchema = z.object({
    id: z.string().min(1),
})

export type DeleteBalanceCheckSchemaType = z.infer<typeof DeleteBalanceCheckSchema>;

export const DeleteAccountSchema = z.object({
    id: z.string().min(1),
})

export type DeleteAccountSchemaType = z.infer<typeof DeleteAccountSchema>;
