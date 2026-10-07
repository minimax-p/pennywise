// How amounts read across Pennywise

// Credit card balances are stored negative (money owed) but read as an amount owed
export function formatBalance(account: { type: string, balance: number }, formatter: Intl.NumberFormat) {
    // Avoid "-$0.00"
    const balance = account.balance === 0 ? 0 : account.balance;
    if (account.type === 'credit') {
        return balance <= 0 ? `${formatter.format(balance === 0 ? 0 : -balance)} owed` : `${formatter.format(balance)} credit`;
    }
    return formatter.format(balance);
}

// "+$12.00" for money in, "-$12.00" for money out
export function formatSigned(amount: number, formatter: Intl.NumberFormat) {
    const rounded = Math.round(amount * 100) / 100;
    if (rounded === 0) return formatter.format(0);
    return `${rounded > 0 ? "+" : "−"}${formatter.format(Math.abs(rounded))}`;
}

// Transaction dates keep the local calendar day in their UTC fields
export const dayFormatter = new Intl.DateTimeFormat(undefined, {timeZone: 'UTC', month: 'short', day: 'numeric'});
export const longDayFormatter = new Intl.DateTimeFormat(undefined, {timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric'});
export const fullDayFormatter = new Intl.DateTimeFormat(undefined, {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});

// "Today", "Yesterday" or "Monday, October 6"
export function dayHeading(date: Date, now = new Date()) {
    const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    if (day === today) return "Today";
    if (day === today - 24 * 60 * 60 * 1000) return "Yesterday";
    const sameYear = date.getUTCFullYear() === now.getFullYear();
    return sameYear ? longDayFormatter.format(date) : fullDayFormatter.format(date);
}
