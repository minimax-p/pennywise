// The arithmetic of splitting one payment between your categories and other people. The
// last line takes whatever is left, so the parts always add up to the total.

export type SplitCategory = { name: string, type: "income" | "expense" };
export type SplitPerson = { id: string, name: string } | { name: string };

export type SplitLine = {
    key: string;
    category: SplitCategory | null;
    person: SplitPerson | null;
    // Typed amount; ignored on the last line
    amount: string;
};

let nextKey = 0;
export const newLine = (fields: Partial<SplitLine>): SplitLine =>
    ({key: `line-${nextKey++}`, category: null, person: null, amount: "", ...fields});

const toCents = (text: string) => Math.round((Number(text) || 0) * 100);

// Each line's amount in cents, the last one taking what's left
export function lineCents(lines: SplitLine[], total: number) {
    const totalCents = Math.round(total * 100);
    const fixed = lines.slice(0, -1).map((l) => toCents(l.amount));
    return [...fixed, totalCents - fixed.reduce((a, b) => a + b, 0)];
}

// What's wrong with the split, or null when it can be saved
export function splitProblem(lines: SplitLine[], total: number): string | null {
    if (lines.length < 2 && !lines.some((l) => l.person)) return "Add another part, or pick one category instead";
    if (lines.some((l) => !l.category && !l.person)) return "Pick a category or person for every part";
    const cents = lineCents(lines, total);
    if (cents.some((c) => c <= 0)) return "Every part needs an amount, and they can't add up to more than the total";
    return null;
}

// Splits the total evenly between you and the people picked; you get the leftover cent
export function splitEvenly(total: number, category: SplitCategory | null, people: SplitPerson[]): SplitLine[] {
    const totalCents = Math.round(total * 100);
    const share = Math.floor(totalCents / (people.length + 1));
    return [
        ...people.map((person) => newLine({person, amount: (share / 100).toFixed(2)})),
        newLine({category}),
    ];
}

