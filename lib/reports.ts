import prisma from "@/lib/prisma";
import {roundMoney} from "@/lib/ledger";
import {classify} from "@/lib/classify";

// Spending and income, computed straight from transactions. See lib/classify.ts for what
// counts as what.

type CategoryInfo = { id: string, name: string, icon: string, type: string };

async function loadRows(userId: string, from: Date, to: Date) {
    const transactions = await prisma.transaction.findMany({
        where: {userId, date: {gte: from, lte: to}, type: {in: ["income", "expense"]}},
        select: {date: true, type: true, amount: true, categoryId: true, lines: {select: {amount: true, categoryId: true}}},
    });
    // A split stands for its shares in categories
    const parts = transactions.flatMap((t) => t.lines.length === 0
        ? [{date: t.date, type: t.type, amount: t.amount, categoryId: t.categoryId}]
        : t.lines.flatMap((l) => l.categoryId ? [{date: t.date, type: t.type, amount: l.amount, categoryId: l.categoryId}] : []));
    const categories = await prisma.category.findMany({
        where: {id: {in: [...new Set(parts.map((r) => r.categoryId))]}},
        select: {id: true, name: true, icon: true, type: true},
    });
    const byId = new Map<string, CategoryInfo>(categories.map((c) => [c.id, c]));
    return parts.flatMap((row) => {
        const category = byId.get(row.categoryId);
        return category ? [{...row, category, ...classify(row.type, category.type, row.amount)}] : [];
    });
}

export async function getTotals(userId: string, from: Date, to: Date) {
    const rows = await loadRows(userId, from, to);
    return {
        spending: roundMoney(rows.reduce((sum, r) => sum + r.spending, 0)),
        income: roundMoney(rows.reduce((sum, r) => sum + r.income, 0)),
    };
}

export type CategoryTotal = { categoryId: string, name: string, icon: string, amount: number };

// Net amount per category, largest first; categories that net to zero are left out
export async function getCategoryTotals(userId: string, from: Date, to: Date) {
    const rows = await loadRows(userId, from, to);
    const totals = (kind: "spending" | "income") => {
        const map = new Map<string, CategoryTotal>();
        for (const row of rows) {
            if (row.category.type !== (kind === "spending" ? "expense" : "income")) continue;
            const entry = map.get(row.category.id)
                ?? {categoryId: row.category.id, name: row.category.name, icon: row.category.icon, amount: 0};
            entry.amount += row[kind];
            map.set(row.category.id, entry);
        }
        return [...map.values()]
            .map((t) => ({...t, amount: roundMoney(t.amount)}))
            .filter((t) => t.amount !== 0)
            .sort((a, b) => b.amount - a.amount);
    };
    return {spending: totals("spending"), income: totals("income")};
}

// Spending per calendar day (yyyy-mm-dd), for running totals
export async function getDailySpending(userId: string, from: Date, to: Date) {
    const rows = await loadRows(userId, from, to);
    const days = new Map<string, number>();
    for (const row of rows) {
        const day = row.date.toISOString().slice(0, 10);
        days.set(day, (days.get(day) ?? 0) + row.spending);
    }
    return days;
}

export type HistoryPoint = { year: number, month: number, day?: number, expense: number, income: number };

// Per month of a year, or per day of a month. Empty when nothing happened in the period.
export async function getHistory(userId: string, timeframe: "month" | "year", year: number, month: number): Promise<HistoryPoint[]> {
    const from = timeframe === "year" ? new Date(Date.UTC(year, 0, 1)) : new Date(Date.UTC(year, month, 1));
    const to = timeframe === "year" ? new Date(Date.UTC(year + 1, 0, 1) - 1) : new Date(Date.UTC(year, month + 1, 1) - 1);
    const rows = await loadRows(userId, from, to);
    if (rows.length === 0) return [];

    const points: HistoryPoint[] = timeframe === "year"
        ? Array.from({length: 12}, (_, m) => ({year, month: m, expense: 0, income: 0}))
        : Array.from({length: new Date(Date.UTC(year, month + 1, 0)).getUTCDate()},
            (_, d) => ({year, month, day: d + 1, expense: 0, income: 0}));
    for (const row of rows) {
        const point = points[timeframe === "year" ? row.date.getUTCMonth() : row.date.getUTCDate() - 1];
        point.expense += row.spending;
        point.income += row.income;
    }
    return points.map((p) => ({...p, expense: roundMoney(p.expense), income: roundMoney(p.income)}));
}

// Years that have transactions, oldest first; this year when there are none
export async function getHistoryYears(userId: string) {
    const range = await prisma.transaction.aggregate({
        where: {userId, type: {in: ["income", "expense"]}},
        _min: {date: true},
        _max: {date: true},
    });
    const first = range._min.date?.getUTCFullYear();
    const last = range._max.date?.getUTCFullYear();
    if (!first || !last) return [new Date().getFullYear()];
    return Array.from({length: last - first + 1}, (_, i) => first + i);
}
