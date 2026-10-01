import z from "zod";

export const UnlinkPlaidItemSchema = z.object({
    id: z.string().min(1),
    deleteTransactions: z.boolean(),
})

export type UnlinkPlaidItemSchemaType = z.infer<typeof UnlinkPlaidItemSchema>;
