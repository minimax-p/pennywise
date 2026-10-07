import z from "zod";
import {ACCOUNT_TYPES} from "@/lib/types";

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const CreateAccountSchema = z.object({
    name: z.string().trim().min(1).max(40),
    type: z.enum(ACCOUNT_TYPES),
    institution: optionalText(60),
    walletCardName: optionalText(80),
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
    archived: z.boolean(),
})

export type EditAccountSchemaType = z.input<typeof EditAccountSchema>;

export const SetAccountBalanceSchema = z.object({
    id: z.string().min(1),
    balance: z.coerce.number(),
    balanceDate: z.coerce.date(),
})

export type SetAccountBalanceSchemaType = z.input<typeof SetAccountBalanceSchema>;

export const DeleteAccountSchema = z.object({
    id: z.string().min(1),
})

export type DeleteAccountSchemaType = z.infer<typeof DeleteAccountSchema>;
