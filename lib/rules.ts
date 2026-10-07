import {Prisma} from "@prisma/client";
import prisma from "@/lib/prisma";
import {payeeKey} from "@/lib/payee";
import {aliasOf} from "@/lib/people";

// Your rules: which transactions they match and what they set. See the Rule model.

type Db = Prisma.TransactionClient;

const ruleInclude = {
    person: {select: {id: true, name: true, aliases: true}},
    category: {select: {id: true, name: true, type: true, icon: true}},
} satisfies Prisma.RuleInclude;

export type LoadedRule = Prisma.RuleGetPayload<{ include: typeof ruleInclude }>;

export function loadRules(userId: string, db: Db = prisma): Promise<LoadedRule[]> {
    return db.rule.findMany({where: {userId}, include: ruleInclude, orderBy: {createdAt: "asc"}});
}

export type RuleInput = {
    description: string;
    // income or expense
    type: string;
    // The person on the line, by id once saved or by the name the bank printed
    personId?: string | null;
    person?: string | null;
};

// The most specific rule that matches: people first, then merchants, then the longest text
export function matchRule(rules: LoadedRule[], input: RuleInput): LoadedRule | null {
    const key = payeeKey(input.description);
    const text = input.description.toUpperCase();
    const alias = input.person ? aliasOf(input.person) : null;
    const matches = rules.filter((rule) => {
        if (rule.direction && rule.direction !== input.type) return false;
        if (rule.kind === "person") {
            return Boolean(rule.person && ((input.personId && input.personId === rule.personId)
                || (alias && rule.person.aliases.includes(alias))));
        }
        if (rule.kind === "merchant") return Boolean(key && rule.pattern === key);
        if (rule.kind === "contains") return Boolean(rule.pattern && text.includes(rule.pattern.toUpperCase()));
        return false;
    });
    const rank = (rule: LoadedRule) => rule.kind === "person" ? 0 : rule.kind === "merchant" ? 1 : 2;
    return matches.sort((a, b) => rank(a) - rank(b) || (b.pattern?.length ?? 0) - (a.pattern?.length ?? 0))[0] ?? null;
}

// Spending needs a spending category; money in can go in either (money back lowers spending)
export function categoryFits(transactionType: string, categoryType: string) {
    return categoryType === "expense" || (categoryType === "income" && transactionType === "income");
}

// How a rule reads: "Walmart → 🛒 Groceries, shown as Walmart"
export function describeRule(rule: LoadedRule) {
    const what = rule.kind === "contains" ? `Description contains “${rule.pattern}”`
        : rule.kind === "person" ? `Money ${rule.direction === "income" ? "from" : rule.direction === "expense" ? "to" : "with"} ${rule.person?.name ?? "someone"}`
            : rule.label;
    const does = [
        rule.category && `${rule.category.icon} ${rule.category.name}`,
        rule.rename && `shown as ${rule.rename}`,
    ].filter(Boolean).join(", ");
    return {what, does};
}

// Files the waiting transactions a new rule matches, so making a rule clears them from Sort.
// With `everything`, past transactions it matches are re-filed too.
export async function applyRule(db: Db, userId: string, rule: LoadedRule, everything = false) {
    const candidates = await db.transaction.findMany({
        where: {
            userId, type: rule.direction ? rule.direction : {in: ["income", "expense"]},
            ...(everything ? {} : {needsReview: true}),
            // Splits keep their parts
            lines: {none: {}},
            ...(rule.kind === "person" ? {personId: rule.personId} : {}),
        },
        select: {id: true, description: true, type: true, personId: true},
    });
    const matched = candidates.filter((t) => matchRule([rule], t)?.id === rule.id);
    if (matched.length === 0) return 0;
    if (rule.rename) {
        await db.transaction.updateMany({where: {id: {in: matched.map((t) => t.id)}}, data: {merchant: rule.rename}});
    }
    if (rule.category) {
        const fileable = matched.filter((t) => categoryFits(t.type, rule.category!.type)).map((t) => t.id);
        await db.transaction.updateMany({
            where: {id: {in: fileable}},
            data: {categoryId: rule.category.id, needsReview: false, categorizedBy: "rule", categoryConfidence: null},
        });
    }
    return matched.length;
}
