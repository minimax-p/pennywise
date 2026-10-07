export type TransactionType = "income" | "expense";
export type TimeFrame = 'month' | 'year';
export type Period = {year : number, month: number};

// cash is bills and coins; wallet is a Venmo, PayPal or Cash App balance
export const ACCOUNT_TYPES = ["checking", "savings", "cd", "credit", "cash", "wallet"] as const;
export type AccountType = typeof ACCOUNT_TYPES[number];
