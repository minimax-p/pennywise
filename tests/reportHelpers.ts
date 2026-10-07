import {getHistory} from "@/lib/reports";

// Spending ("expense") and income per day and per month of a year, from the reports,
// in the shape the old running-total tables had. Months and days with nothing are left out.
export async function historyTotals(userId: string, year = 2026) {
    const nonZero = (p: { income: number, expense: number }) => p.income !== 0 || p.expense !== 0;
    const months = (await getHistory(userId, "year", year, 0)).filter(nonZero)
        .map(({month, income, expense}) => ({month, income, expense}));
    const days: { month: number, day: number, income: number, expense: number }[] = [];
    for (const {month} of months) {
        days.push(...(await getHistory(userId, "month", year, month)).filter(nonZero)
            .map(({month, day, income, expense}) => ({month, day: day!, income, expense})));
    }
    return {days, months};
}
