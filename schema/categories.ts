import z from "zod";

export const CreateCategorySchema = z.object({
    name: z.string().min(3).max(20),
    icon: z.string().max(20),
    type: z.enum(["income","expense"])
})

export type CreateCategorySchemaType = z.infer<typeof CreateCategorySchema>;

export const DeleteCategorySchema = z.object({
    name: z.string().min(3).max(20),
    type: z.enum(["income","expense"])
})

export type DeleteCategorySchemaType = z.infer<typeof DeleteCategorySchema>;

export const EditCategorySchema = z.object({
    oldName: z.string().min(3).max(20),
    newName: z.string().min(3).max(20),
    icon: z.string().max(20),
    type: z.enum(["income","expense"])
})

export type EditCategorySchemaType = z.infer<typeof EditCategorySchema>;