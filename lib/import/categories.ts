import prisma from "@/lib/prisma";
import {payeeKey} from "@/lib/payee";
import type {StatementRow} from "@/lib/import/parse";

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

// Fallbacks from the description when nothing better is known
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

// One suggested category name per row: what you chose last time for the same merchant,
// then the bank's category, then keywords, then Unsorted
export async function suggestCategoryName(userId: string, rows: StatementRow[]): Promise<string[]> {
    const keys = rows.map((r) => payeeKey(r.description));
    const wanted = [...new Set(keys.filter((k): k is string => k !== null))];

    const learned = new Map<string, string>();
    if (wanted.length > 0) {
        const past = await prisma.transaction.findMany({
            where: {userId, payeeKey: {in: wanted}, type: {in: ["income", "expense"]}},
            orderBy: {date: "desc"},
            select: {payeeKey: true, type: true, category: {select: {name: true}}},
        });
        for (const t of past) {
            const key = `${t.type}:${t.payeeKey}`;
            if (!learned.has(key) && t.category.name !== "Unsorted") learned.set(key, t.category.name);
        }
    }

    return rows.map((row, i) => {
        const income = row.amount > 0;
        const fromHistory = keys[i] && learned.get(`${income ? "income" : "expense"}:${keys[i]}`);
        if (fromHistory) return fromHistory;
        if (!income && row.bankCategory) {
            const fromBank = BANK_CATEGORIES[row.bankCategory.trim().toUpperCase()];
            if (fromBank) return fromBank;
        }
        const rule = KEYWORD_RULES.find((r) => r.income === income && r.pattern.test(row.description));
        return rule?.name ?? "Unsorted";
    });
}
