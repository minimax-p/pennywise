import prisma from "@/lib/prisma";
import {payeeKey} from "@/lib/payee";
import {Alternative, askJev, AUTO_ACCEPT_CONFIDENCE, CategoryOption, jevEnabled, JevContext, PastChoice} from "@/lib/categorize/jev";

// Picks a category for new transactions, most trusted source first:
// 1. what you chose before for the same merchant
// 2. the category the bank put in its export
// 3. keywords like PAYROLL or NETFLIX
// 4. Jev, when TYPESAFE_API_KEY is set
// Anything left is Unsorted and waits on the Sort page.

export type CategorySource = "history" | "bank" | "keyword" | "ai" | "none";

export type CategorySuggestion = {
    name: string;
    source: CategorySource;
    // Jev's confidence, for AI suggestions
    confidence: number | null;
    // Jev's most likely categories, offered on the Sort page
    alternatives: Alternative[] | null;
};

export type SuggestInput = {
    description: string;
    // Positive when money came in
    amount: number;
    date: Date;
    bankCategory: string | null;
    accountName?: string | null;
    accountType?: string | null;
};

// Category names below are the universal categories from prisma/seed.mjs

// Categories Chase, Discover and Capital One card exports put in their Category column
const BANK_CATEGORIES: Record<string, string> = {
    // Chase
    "FOOD & DRINK": "Restaurants",
    "GROCERIES": "Groceries",
    "GAS": "Gas",
    "SHOPPING": "General",
    "ENTERTAINMENT": "Events & Concerts",
    "BILLS & UTILITIES": "Utilities",
    "HEALTH & WELLNESS": "Healthcare",
    "PERSONAL": "Beauty & Grooming",
    "HOME": "Home Furnishings",
    "AUTOMOTIVE": "Vehicle Maintenance",
    // Discover
    "RESTAURANTS": "Restaurants",
    "SUPERMARKETS": "Groceries",
    "GASOLINE": "Gas",
    "MERCHANDISE": "General",
    "DEPARTMENT STORES": "General",
    "HOME IMPROVEMENT": "Maintenance",
    "MEDICAL SERVICES": "Healthcare",
    "TRAVEL/ ENTERTAINMENT": "Events & Concerts",
    // Capital One
    "DINING": "Restaurants",
    "GAS/AUTOMOTIVE": "Gas",
    "HEALTH CARE": "Healthcare",
    "MERCHANDISE & SUPPLIES": "General",
    "PHONE/CABLE": "Internet",
    "UTILITIES": "Utilities",
};

const KEYWORD_RULES: { pattern: RegExp, income: boolean, name: string }[] = [
    {pattern: /PAYROLL|DIRECT DEP|DIR DEP|SALARY/i, income: true, name: "Salary"},
    {pattern: /INTEREST|DIVIDEND/i, income: true, name: "Dividends & Interest"},
    {pattern: /CASHBACK|CASH BACK|REWARD/i, income: true, name: "Dividends & Interest"},
    {pattern: /UBER\b|LYFT/i, income: false, name: "Taxi/Uber"},
    {pattern: /DOORDASH|UBER EATS|GRUBHUB/i, income: false, name: "Food Delivery"},
    {pattern: /NETFLIX|HULU|DISNEY PLUS|HBO|MAX\.COM|YOUTUBE PREMIUM/i, income: false, name: "Streaming Services"},
    {pattern: /SPOTIFY|APPLE MUSIC/i, income: false, name: "Music"},
    {pattern: /AMAZON|AMZN/i, income: false, name: "Amazon"},
];

// Only categories you picked (or confirmed) teach future suggestions, so an AI guess
// you never looked at can't spread to other transactions
export const TRUSTED_CATEGORY = {
    needsReview: false,
    OR: [{categorizedBy: null}, {categorizedBy: {in: ["you", "history"]}}],
};

export function needsReview(suggestion: CategorySuggestion) {
    return suggestion.name === "Unsorted"
        || suggestion.source === "none"
        || (suggestion.source === "ai" && (suggestion.confidence ?? 0) < AUTO_ACCEPT_CONFIDENCE);
}

// What to store on a transaction filed under this suggestion
export function categorizationFields(suggestion: CategorySuggestion) {
    return {
        needsReview: needsReview(suggestion),
        categorizedBy: suggestion.source === "none" ? null : suggestion.source,
        categoryConfidence: suggestion.source === "ai" ? suggestion.confidence : null,
        ...(suggestion.alternatives && {aiSuggestions: suggestion.alternatives}),
    };
}

async function loadJevContext(userId: string): Promise<JevContext> {
    const categories = await prisma.category.findMany({
        where: {OR: [{userId}, {isUniversal: true}], type: {in: ["income", "expense"]}, NOT: {name: "Unsorted"}},
        orderBy: {name: "asc"},
    });
    const recent = await prisma.transaction.findMany({
        where: {userId, type: {in: ["income", "expense"]}, payeeKey: {not: null}, ...TRUSTED_CATEGORY},
        orderBy: {date: "desc"},
        take: 300,
        select: {payeeKey: true, type: true, category: {select: {name: true}}},
    });

    const options = (type: string): CategoryOption[] =>
        categories.filter((c) => c.type === type).map((c) => ({name: c.name, group: c.tag}));
    // Your most recent choice for each merchant
    const pastChoices = (type: string): PastChoice[] => {
        const byMerchant = new Map<string, string>();
        for (const t of recent) {
            if (t.type === type && t.category.name !== "Unsorted" && !byMerchant.has(t.payeeKey!)) {
                byMerchant.set(t.payeeKey!, t.category.name);
            }
        }
        return [...byMerchant].map(([merchant, category]) => ({merchant, category}));
    };

    return {
        categories: {income: options("income"), expense: options("expense")},
        pastChoices: {income: pastChoices("income"), expense: pastChoices("expense")},
    };
}

// useAi says which inputs may go to Jev (e.g. not lines that will become transfers)
export async function suggestCategories(
    userId: string,
    inputs: SuggestInput[],
    useAi: (index: number) => boolean = () => true,
): Promise<CategorySuggestion[]> {
    const keys = inputs.map((r) => payeeKey(r.description));
    const wanted = [...new Set(keys.filter((k): k is string => k !== null))];

    const learned = new Map<string, string>();
    if (wanted.length > 0) {
        const past = await prisma.transaction.findMany({
            where: {userId, payeeKey: {in: wanted}, type: {in: ["income", "expense"]}, ...TRUSTED_CATEGORY},
            orderBy: {date: "desc"},
            select: {payeeKey: true, type: true, category: {select: {name: true}}},
        });
        for (const t of past) {
            const key = `${t.type}:${t.payeeKey}`;
            if (!learned.has(key) && t.category.name !== "Unsorted") learned.set(key, t.category.name);
        }
    }

    const suggestions = inputs.map((input, i): CategorySuggestion => {
        const income = input.amount > 0;
        const none = {confidence: null, alternatives: null};
        const fromHistory = keys[i] && learned.get(`${income ? "income" : "expense"}:${keys[i]}`);
        if (fromHistory) return {name: fromHistory, source: "history", ...none};
        if (!income && input.bankCategory) {
            const fromBank = BANK_CATEGORIES[input.bankCategory.trim().toUpperCase()];
            if (fromBank) return {name: fromBank, source: "bank", ...none};
        }
        const rule = KEYWORD_RULES.find((r) => r.income === income && r.pattern.test(input.description));
        if (rule) return {name: rule.name, source: "keyword", ...none};
        return {name: "Unsorted", source: "none", ...none};
    });

    // Ask Jev once per merchant and direction for whatever is still unsorted
    if (jevEnabled()) {
        const groups = new Map<string, number[]>();
        suggestions.forEach((s, i) => {
            if (s.source !== "none" || !useAi(i)) return;
            const groupKey = `${inputs[i].amount > 0 ? "in" : "out"}:${keys[i] ?? inputs[i].description.toUpperCase()}`;
            groups.set(groupKey, [...(groups.get(groupKey) ?? []), i]);
        });
        if (groups.size > 0) {
            const representatives = [...groups.values()].map((indexes) => indexes[0]);
            const answers = await askJev(representatives.map((i) => ({
                description: inputs[i].description,
                amount: inputs[i].amount,
                date: inputs[i].date,
                bankCategory: inputs[i].bankCategory,
                accountName: inputs[i].accountName ?? null,
                accountType: inputs[i].accountType ?? null,
            })), await loadJevContext(userId));
            [...groups.values()].forEach((indexes, g) => {
                const answer = answers[g];
                if (!answer) return;
                for (const i of indexes) {
                    suggestions[i] = {name: answer.name, source: "ai", confidence: answer.confidence, alternatives: answer.alternatives};
                }
            });
        }
    }

    return suggestions;
}
