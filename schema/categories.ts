import z from "zod";

const name = z.string().trim().min(1, "Type a name").max(40);
const icon = z.string().trim().min(1, "Pick an emoji").max(20);
const group = z.string().trim().max(40).nullish().transform((v) => v || null);

export const CreateCategorySchema = z.object({
    name,
    icon,
    type: z.enum(["income", "expense"]),
    group,
})

export type CreateCategorySchemaType = z.input<typeof CreateCategorySchema>;

export const UpdateCategorySchema = z.object({
    id: z.string().min(1),
    name,
    icon,
    group,
    hidden: z.boolean(),
})

export type UpdateCategorySchemaType = z.input<typeof UpdateCategorySchema>;

export const MergeCategorySchema = z.object({
    fromId: z.string().min(1),
    intoId: z.string().min(1),
})
