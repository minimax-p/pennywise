import {describe, expect, it} from "vitest";
import {aggregateHistoryChanges} from "@/lib/history";

describe("aggregateHistoryChanges", () => {
    it("groups changes by day and by month using UTC date fields", () => {
        const {days, months} = aggregateHistoryChanges([
            {date: new Date("2026-09-10T00:00:00Z"), type: "expense", amount: 10},
            {date: new Date("2026-09-10T23:59:00Z"), type: "expense", amount: 5},
            {date: new Date("2026-09-11T00:00:00Z"), type: "income", amount: 100},
            {date: new Date("2026-10-01T00:00:00Z"), type: "expense", amount: 7},
        ]);

        expect(days).toEqual([
            {year: 2026, month: 8, day: 10, income: 0, expense: 15},
            {year: 2026, month: 8, day: 11, income: 100, expense: 0},
            {year: 2026, month: 9, day: 1, income: 0, expense: 7},
        ]);
        expect(months).toEqual([
            {year: 2026, month: 8, income: 100, expense: 15},
            {year: 2026, month: 9, income: 0, expense: 7},
        ]);
    });

    it("drops days whose changes cancel out", () => {
        const date = new Date("2026-09-10T00:00:00Z");
        const {days, months} = aggregateHistoryChanges([
            {date, type: "expense", amount: 20},
            {date, type: "expense", amount: -20},
        ]);
        expect(days).toEqual([]);
        expect(months).toEqual([]);
    });

    it("keeps moves between days within the same month", () => {
        const {days, months} = aggregateHistoryChanges([
            {date: new Date("2026-09-10T00:00:00Z"), type: "expense", amount: -20},
            {date: new Date("2026-09-12T00:00:00Z"), type: "expense", amount: 20},
        ]);
        expect(days).toHaveLength(2);
        expect(months).toEqual([]);
    });
});
