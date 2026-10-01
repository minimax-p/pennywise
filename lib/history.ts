import {Prisma} from "@prisma/client";

// MonthHistory (per day) and YearHistory (per month) hold running income/expense totals.
// Every write to the Transaction table must apply the matching change here.

export type HistoryChange = {
    date: Date;
    type: string;
    // Positive when a transaction is added, negative when it is removed
    amount: number;
};

type Totals = { income: number, expense: number };
export type DayDelta = Totals & { year: number, month: number, day: number };
export type MonthDelta = Totals & { year: number, month: number };

export function aggregateHistoryChanges(changes: HistoryChange[]) {
    const days = new Map<string, DayDelta>();
    const months = new Map<string, MonthDelta>();

    for (const change of changes) {
        if (!change.amount) continue;
        const year = change.date.getUTCFullYear();
        const month = change.date.getUTCMonth();
        const day = change.date.getUTCDate();
        const income = change.type === "income" ? change.amount : 0;
        const expense = change.type === "expense" ? change.amount : 0;

        const dayKey = `${year}-${month}-${day}`;
        const dayDelta = days.get(dayKey) ?? {year, month, day, income: 0, expense: 0};
        dayDelta.income += income;
        dayDelta.expense += expense;
        days.set(dayKey, dayDelta);

        const monthKey = `${year}-${month}`;
        const monthDelta = months.get(monthKey) ?? {year, month, income: 0, expense: 0};
        monthDelta.income += income;
        monthDelta.expense += expense;
        months.set(monthKey, monthDelta);
    }

    const nonZero = (t: Totals) => t.income !== 0 || t.expense !== 0;
    return {
        days: [...days.values()].filter(nonZero),
        months: [...months.values()].filter(nonZero),
    };
}

export async function applyHistoryChanges(tx: Prisma.TransactionClient, userId: string, changes: HistoryChange[]) {
    const {days, months} = aggregateHistoryChanges(changes);

    for (const {year, month, day, income, expense} of days) {
        await tx.monthHistory.upsert({
            where: {day_month_year_userId: {userId, day, month, year}},
            create: {userId, day, month, year, income, expense},
            update: {income: {increment: income}, expense: {increment: expense}},
        });
    }

    for (const {year, month, income, expense} of months) {
        await tx.yearHistory.upsert({
            where: {month_year_userId: {userId, month, year}},
            create: {userId, month, year, income, expense},
            update: {income: {increment: income}, expense: {increment: expense}},
        });
    }
}
