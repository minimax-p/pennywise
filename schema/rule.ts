import z from "zod";

export const RuleSchema = z.object({
    // Set when editing
    id: z.string().min(1).optional(),
    kind: z.enum(["merchant", "contains", "person"]),
    // The text to look for (contains) or the merchant key (merchant)
    pattern: z.string().trim().max(191).nullish().transform((v) => v || null),
    personId: z.string().min(1).nullish().transform((v) => v || null),
    direction: z.enum(["income", "expense"]).nullish().transform((v) => v ?? null),
    category: z.object({name: z.string().min(1), type: z.enum(["income", "expense"])}).nullish(),
    rename: z.string().trim().max(80).nullish().transform((v) => v || null),
    label: z.string().trim().max(191).nullish(),
    // Also re-file past transactions it matches, not only the ones waiting on Sort
    applyToPast: z.boolean().default(false),
}).superRefine((r, ctx) => {
    if ((r.kind === "contains" || r.kind === "merchant") && !r.pattern) {
        ctx.addIssue({code: "custom", message: "Type the text to look for", path: ["pattern"]});
    }
    if (r.kind === "person" && !r.personId) ctx.addIssue({code: "custom", message: "Pick a person", path: ["personId"]});
    if (!r.category && !r.rename) ctx.addIssue({code: "custom", message: "Pick a category or a name to show", path: ["category"]});
});

export type RuleSchemaType = z.input<typeof RuleSchema>;
