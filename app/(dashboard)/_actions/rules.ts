"use server";

import {ActionResult, requireUser} from "@/lib/actionResult";
import prisma from "@/lib/prisma";
import {RuleSchema, RuleSchemaType} from "@/schema/rule";
import {findCategory} from "@/lib/entries";
import {applyRule, loadRules} from "@/lib/rules";

// Saves a rule, and files what it matches: the transactions waiting on Sort, and with
// applyToPast every past one too
export async function SaveRule(form: RuleSchemaType): Promise<ActionResult<{ applied: number }>> {
    const parsed = SaveRuleSchemaParse(form);
    if (!parsed.success) return {ok: false, error: parsed.error};
    const user = await requireUser();
    const {id, kind, pattern, personId, direction, category, rename, label, applyToPast} = parsed.data;

    const person = personId ? await prisma.person.findFirst({where: {id: personId, userId: user.id}}) : null;
    if (personId && !person) return {ok: false, error: "Person not found"};
    const categoryRow = category ? await findCategory(prisma, user.id, category.name, category.type) : null;
    if (category && !categoryRow) return {ok: false, error: "Category not found"};
    if (categoryRow?.type === "income" && direction === "expense") return {ok: false, error: "Spending can't go in an income category"};
    if (id && !await prisma.rule.findFirst({where: {id, userId: user.id}})) return {ok: false, error: "Rule not found"};

    const data = {
        kind, direction, rename,
        pattern: kind === "contains" ? pattern : kind === "merchant" ? pattern!.toUpperCase() : null,
        personId: kind === "person" ? personId : null,
        categoryId: categoryRow?.id ?? null,
        label: label || (kind === "person" ? person!.name : pattern!),
    };
    const applied = await prisma.$transaction(async (tx) => {
        const saved = id ? await tx.rule.update({where: {id}, data}) : await tx.rule.create({data: {...data, userId: user.id}});
        const rule = (await loadRules(user.id, tx)).find((r) => r.id === saved.id)!;
        return applyRule(tx, user.id, rule, applyToPast);
    });
    return {ok: true, data: {applied}};
}

function SaveRuleSchemaParse(form: RuleSchemaType) {
    const parsed = RuleSchema.safeParse(form);
    return parsed.success ? {success: true as const, data: parsed.data} : {success: false as const, error: parsed.error.issues[0]?.message ?? "Check the rule"};
}

export async function DeleteRule(id: string): Promise<ActionResult<null>> {
    const user = await requireUser();
    const result = await prisma.rule.deleteMany({where: {id, userId: user.id}});
    return result.count ? {ok: true, data: null} : {ok: false, error: "Rule not found"};
}
