export type TransactionType = "income" | "expense";
export type TimeFrame = 'month' | 'year';
export type Period = {year : number, month: number};

export const ACCOUNT_TYPES = ["checking", "savings", "credit", "cash"] as const;
export type AccountType = typeof ACCOUNT_TYPES[number];
