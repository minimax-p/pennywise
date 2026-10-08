import {requireUser} from "@/lib/actionResult";
import {describeRule, loadRules} from "@/lib/rules";

export const dynamic = "force-dynamic";

export async function GET() {
    const user = await requireUser();
    const rules = await loadRules(user.id);
    return Response.json(rules.map((rule) => ({
        id: rule.id,
        kind: rule.kind,
        pattern: rule.pattern,
        direction: rule.direction,
        person: rule.person && {id: rule.person.id, name: rule.person.name},
        category: rule.category && {name: rule.category.name, type: rule.category.type, icon: rule.category.icon},
        rename: rule.rename,
        label: rule.label,
        ...describeRule(rule),
    })));
}

export type GetRulesResponseType = {
    id: string, kind: "merchant" | "contains" | "person", pattern: string | null, direction: "income" | "expense" | null,
    person: { id: string, name: string } | null, category: { name: string, type: "income" | "expense", icon: string } | null,
    rename: string | null, label: string, what: string, does: string,
}[];
