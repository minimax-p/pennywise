// Whether money counts as spending or income. Shared by reports on the server and lists
// in the browser, so both always agree.
//
// What money counts as follows its category: money out in a spending category is
// spending, and money back in one (a refund, a friend paying you back) lowers it. Money in
// to an income category is income. Transfers and balance adjustments count as neither.
// A split counts each of your shares in its own category; other people's shares are what
// they owe you, not your spending.

export function classify(type: string, categoryType: string, amount: number): { spending: number, income: number } {
    const direction = type === "expense" ? -1 : type === "income" ? 1 : 0;
    if (categoryType === "expense") return {spending: -direction * amount, income: 0};
    if (categoryType === "income") return {spending: 0, income: direction * amount};
    return {spending: 0, income: 0};
}

type ClassifiableRow = {
    type: string,
    amount: number,
    category: { type: string },
    lines?: { amount: number, category: { type: string } | null }[],
};

export function classifyRow(row: ClassifiableRow): { spending: number, income: number } {
    if (!row.lines || row.lines.length === 0) return classify(row.type, row.category.type, row.amount);
    return row.lines.reduce((sum, line) => {
        if (!line.category) return sum;
        const part = classify(row.type, line.category.type, line.amount);
        return {spending: sum.spending + part.spending, income: sum.income + part.income};
    }, {spending: 0, income: 0});
}
