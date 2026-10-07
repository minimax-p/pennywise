import {createHash} from "node:crypto";
import Papa from "papaparse";

// Parses bank statement files (CSV and OFX/QFX/QBO) into rows with a signed amount:
// positive when money came into the account, negative when it left.

export type StatementRow = {
    // UTC midnight of the transaction's calendar day
    date: Date;
    amount: number;
    description: string;
    // FITID in OFX files, or an id column in CSVs
    externalId: string | null;
    // Category the bank assigned, if the file has one
    bankCategory: string | null;
    // Set when the row should not be imported by default, with the reason
    skipReason: string | null;
    // The account's balance right after this line, when the file has a balance column
    balance?: number | null;
    // Extra text from the bank, like an OFX memo, kept as the transaction's note
    memo?: string | null;
};

// A balance the statement shows for the end of a day
export type StatementBalance = { date: Date, balance: number };

export type ColumnMapping = {
    date: string;
    description: string;
    // A single signed amount column...
    amount?: string;
    // ...or separate columns for money out and money in...
    debit?: string;
    credit?: string;
    // ...or an unsigned amount plus a column saying "Debit" or "Credit"
    direction?: string;
    category?: string;
    id?: string;
    // Running balance after each line
    balance?: string;
    // Amounts are positive for money out, as some credit cards export them
    invertSign?: boolean;
    // Bank-specific handling, see PRESETS
    preset?: PresetName;
};

export type ParsedFile =
    | { format: "ofx", rows: StatementRow[], skipped: number, balance: StatementBalance | null }
    | { format: "csv", headers: string[], records: string[][] };

export type PresetName = "chase-checking" | "chase-card" | "discover" | "capital-one-bank" | "capital-one-card" | "venmo";

const PRESETS: { name: PresetName, label: string, headers: string[], mapping: Omit<ColumnMapping, "preset"> }[] = [
    {
        name: "chase-checking", label: "Chase checking or savings",
        headers: ["Details", "Posting Date", "Description", "Amount"],
        mapping: {date: "Posting Date", description: "Description", amount: "Amount", balance: "Balance"},
    },
    {
        name: "chase-card", label: "Chase credit card",
        headers: ["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount"],
        mapping: {date: "Transaction Date", description: "Description", amount: "Amount", category: "Category"},
    },
    {
        // Discover has used both sign conventions, so invertSign is decided from the data
        name: "discover", label: "Discover card",
        headers: ["Trans. Date", "Post Date", "Description", "Amount", "Category"],
        mapping: {date: "Trans. Date", description: "Description", amount: "Amount", category: "Category"},
    },
    {
        name: "capital-one-bank", label: "Capital One 360",
        headers: ["Transaction Description", "Transaction Date", "Transaction Type", "Transaction Amount"],
        mapping: {date: "Transaction Date", description: "Transaction Description", amount: "Transaction Amount", direction: "Transaction Type"},
    },
    {
        name: "capital-one-card", label: "Capital One credit card",
        headers: ["Transaction Date", "Posted Date", "Description", "Category", "Debit", "Credit"],
        mapping: {date: "Transaction Date", description: "Description", debit: "Debit", credit: "Credit", category: "Category"},
    },
    {
        name: "venmo", label: "Venmo",
        headers: ["ID", "Datetime", "Type", "Status", "Note", "From", "To", "Amount (total)"],
        mapping: {date: "Datetime", description: "Note", amount: "Amount (total)", id: "ID"},
    },
];

export function presetLabel(name: PresetName | undefined) {
    return PRESETS.find((p) => p.name === name)?.label ?? null;
}

// ---------- Values ----------

// "$1,234.56", "-1,234.56", "(1,234.56)", "- $25.00", "+ $10.00", "1,234.56-"
export function parseAmount(value: string | undefined | null): number | null {
    if (value == null) return null;
    let text = String(value).trim();
    if (!text) return null;
    let negative = false;
    if (/^\(.*\)$/.test(text)) {
        negative = true;
        text = text.slice(1, -1);
    }
    if (text.endsWith("-")) {
        negative = !negative;
        text = text.slice(0, -1);
    }
    text = text.replace(/[$€£\s]/g, "");
    if (text.startsWith("-")) {
        negative = !negative;
        text = text.slice(1);
    } else if (text.startsWith("+")) {
        text = text.slice(1);
    }
    text = text.replace(/,/g, "");
    if (!/^\d*\.?\d+$/.test(text)) return null;
    const amount = Number(text);
    return Math.round((negative ? -amount : amount) * 100) / 100;
}

// US formats: 10/05/2026, 10/5/26, 2026-10-05, 2026-10-05T14:22:10, 20261005
export function parseDate(value: string | undefined | null): Date | null {
    if (!value) return null;
    const text = String(value).trim();
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) ?? text.match(/^(\d{4})(\d{2})(\d{2})/);
    if (match) return utcDay(Number(match[1]), Number(match[2]), Number(match[3]));
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/);
    if (match) {
        const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
        return utcDay(year, Number(match[1]), Number(match[2]));
    }
    return null;
}

function utcDay(year: number, month: number, day: number): Date | null {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCDate() === day ? date : null;
}

// ---------- OFX / QFX / QBO ----------

function decodeEntities(text: string) {
    return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function ofxField(block: string, tag: string): string | null {
    // Works for both SGML (no closing tags) and XML OFX
    const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
    return match ? decodeEntities(match[1].trim()) : null;
}

export function isOfx(content: string) {
    return /<OFX>/i.test(content);
}

// End of a statement day, when a balance shown for that day was true
export function endOfDay(day: Date): Date {
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999));
}

export function parseOfx(content: string): { rows: StatementRow[], skipped: number, balance: StatementBalance | null } {
    const rows: StatementRow[] = [];
    let skipped = 0;
    const blocks = content.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi) ?? [];
    for (const block of blocks) {
        const date = parseDate(ofxField(block, "DTPOSTED"));
        const amount = parseAmount(ofxField(block, "TRNAMT"));
        if (!date || amount === null || amount === 0) {
            skipped++;
            continue;
        }
        const name = ofxField(block, "NAME") ?? "";
        const memo = ofxField(block, "MEMO") ?? "";
        // NAME is cut off at 32 characters, and banks often repeat it in full as the memo
        const fullName = name && memo.toUpperCase().startsWith(name.toUpperCase()) ? memo : name;
        rows.push({
            date,
            amount,
            description: (fullName || memo).slice(0, 191),
            externalId: ofxField(block, "FITID"),
            bankCategory: null,
            skipReason: null,
            memo: name && memo && fullName === name && memo.toUpperCase() !== name.toUpperCase() ? memo.slice(0, 500) : null,
        });
    }
    const ledger = content.match(/<LEDGERBAL>[\s\S]*?(?=<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>|$)/i)?.[0];
    const balanceAmount = ledger ? parseAmount(ofxField(ledger, "BALAMT")) : null;
    const balanceDay = ledger ? parseDate(ofxField(ledger, "DTASOF")) : null;
    const balance = balanceAmount !== null && balanceDay ? {date: endOfDay(balanceDay), balance: balanceAmount} : null;
    return {rows, skipped, balance};
}

// ---------- CSV ----------

export function parseFile(content: string): ParsedFile {
    if (isOfx(content)) {
        return {format: "ofx", ...parseOfx(content)};
    }
    const {data} = Papa.parse<string[]>(content.replace(/^﻿/, ""), {skipEmptyLines: "greedy"});
    // Some exports (Venmo) put title lines above the column headers
    const headerIndex = data.slice(0, 10).findIndex((row) =>
        row.filter((cell) => cell.trim()).length >= 2
        && row.some((cell) => /date/i.test(cell))
        && row.some((cell) => /amount|debit|credit|withdraw|deposit|money (in|out)/i.test(cell))
    );
    if (headerIndex === -1) {
        throw new Error("Could not find the column headers. Is this a bank statement CSV, OFX or QFX file?");
    }
    const headers = data[headerIndex].map((h) => h.trim());
    return {format: "csv", headers, records: data.slice(headerIndex + 1)};
}

function findHeader(headers: string[], patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
        const found = headers.find((h) => pattern.test(h));
        if (found) return found;
    }
    return undefined;
}

// Recognizes known bank formats, otherwise guesses from the header names
export function guessMapping(headers: string[], records: string[][], accountType: string): ColumnMapping {
    const preset = PRESETS.find((p) => p.headers.every((h) => headers.includes(h)));
    const mapping: ColumnMapping = preset ? {...preset.mapping, preset: preset.name} : {
        date: findHeader(headers, [/^trans(action)?\.? ?date$/i, /^date$/i, /post(ing|ed)? date/i, /date/i]) ?? headers[0],
        description: findHeader(headers, [/^description$/i, /description/i, /payee|merchant|^name$/i, /memo|note/i]) ?? headers[1],
        amount: findHeader(headers, [/^amount$/i, /amount \(total\)/i, /amount/i]),
        category: findHeader(headers, [/category/i]),
        id: findHeader(headers, [/^id$/i, /transaction id|reference/i]),
    };

    if (!preset && !mapping.amount) {
        mapping.debit = findHeader(headers, [/^debit/i, /withdrawal/i, /money out/i]);
        mapping.credit = findHeader(headers, [/^credit/i, /deposit/i, /money in/i]);
    }

    // Unsigned amounts with a type column that says debit or credit
    if (!preset && mapping.amount) {
        const index = headers.indexOf(mapping.amount);
        const amounts = records.map((r) => parseAmount(r[index])).filter((a): a is number => a !== null);
        if (amounts.length > 0 && amounts.every((a) => a >= 0)) {
            const directionColumn = headers.find((h, i) =>
                h !== mapping.amount && records.some((r) => /^(debit|credit)$/i.test((r[i] ?? "").trim())));
            if (directionColumn) mapping.direction = directionColumn;
        }
    }

    // Card statements are mostly purchases, so the more common sign is money out
    if (accountType === "credit" && mapping.amount && !mapping.direction) {
        const index = headers.indexOf(mapping.amount);
        const amounts = records.map((r) => parseAmount(r[index])).filter((a): a is number => a !== null && a !== 0);
        const positive = amounts.filter((a) => a > 0).length;
        mapping.invertSign = positive > amounts.length / 2;
    }

    return withBalanceColumn(mapping, headers);
}

// Mappings saved before balances were read, or picked by hand, still get the balance column
export function withBalanceColumn(mapping: ColumnMapping, headers: string[]): ColumnMapping {
    if (mapping.balance && headers.includes(mapping.balance)) return mapping;
    const balance = findHeader(headers, [/^balance$/i, /^running bal/i]);
    return balance ? {...mapping, balance} : mapping;
}

function cell(headers: string[], record: string[], column: string | undefined) {
    if (!column) return "";
    const index = headers.indexOf(column);
    return index === -1 ? "" : (record[index] ?? "").trim();
}

export function applyMapping(headers: string[], records: string[][], mapping: ColumnMapping): { rows: StatementRow[], skipped: number } {
    const rows: StatementRow[] = [];
    let skipped = 0;

    for (const record of records) {
        const get = (column: string | undefined) => cell(headers, record, column);
        const date = parseDate(get(mapping.date));

        let amount: number | null;
        if (mapping.debit || mapping.credit) {
            const out = parseAmount(get(mapping.debit));
            const into = parseAmount(get(mapping.credit));
            amount = out ? -Math.abs(out) : into ? Math.abs(into) : null;
        } else {
            amount = parseAmount(get(mapping.amount));
            if (amount !== null && mapping.direction) {
                amount = /debit|withdrawal/i.test(get(mapping.direction)) ? -Math.abs(amount) : Math.abs(amount);
            }
            if (amount !== null && mapping.invertSign) amount = -amount;
        }

        if (!date || amount === null || amount === 0) {
            // Balance lines, footers and blank rows
            skipped++;
            continue;
        }

        let description = get(mapping.description);
        let skipReason: string | null = null;

        if (mapping.preset === "venmo") {
            const status = get("Status");
            if (status && !/complete/i.test(status)) {
                skipped++;
                continue;
            }
            const counterpart = amount < 0 ? get("To") : get("From");
            description = [counterpart, description].filter(Boolean).join(": ") || get("Type");
            const funding = get("Funding Source");
            // Paid straight from a bank or card, so the Venmo balance did not change and
            // the payment shows up on that bank's statement instead
            if (amount < 0 && funding && !/venmo balance/i.test(funding)) {
                skipReason = `Paid from ${funding}, so it is on that statement`;
            }
        }

        // Card files with flipped signs show balances owed as positive numbers too
        const balance = mapping.balance && !mapping.invertSign ? parseAmount(get(mapping.balance)) : null;
        rows.push({
            date,
            amount,
            description: description.slice(0, 191),
            externalId: get(mapping.id) || null,
            bankCategory: get(mapping.category) || null,
            skipReason,
            balance,
        });
    }

    return {rows, skipped};
}

// ---------- Fingerprints ----------

// Identifies a statement line across re-imports. Identical lines on the same day
// (two coffees for the same price) are told apart by their order in the file.
export function fingerprintRows(rows: StatementRow[]): string[] {
    const seen = new Map<string, number>();
    return rows.map((row) => {
        if (row.externalId) return `id:${row.externalId}`;
        const base = [
            row.date.toISOString().slice(0, 10),
            row.amount.toFixed(2),
            row.description.trim().replace(/\s+/g, " ").toUpperCase(),
        ].join("|");
        const occurrence = (seen.get(base) ?? 0) + 1;
        seen.set(base, occurrence);
        return `h:${createHash("sha256").update(base).digest("hex").slice(0, 32)}:${occurrence}`;
    });
}

// ---------- Balances ----------

// End-of-day balances from a file with a running balance column, plus the balance before
// its first line. Statements list lines newest first or oldest first; the order whose
// balances add up line by line is used, and none are returned if neither does.
export function statementBalances(rows: StatementRow[]): StatementBalance[] {
    if (rows.length === 0 || rows.some((r) => r.balance == null)) return [];
    const addsUp = (ordered: StatementRow[]) => ordered.every((row, i) =>
        i === 0 || Math.abs(ordered[i - 1].balance! + row.amount - row.balance!) < 0.005);
    const reversed = [...rows].reverse();
    const chronological = rows[0].date >= rows[rows.length - 1].date && addsUp(reversed) ? reversed
        : addsUp(rows) ? rows : null;
    if (!chronological) return [];

    const first = chronological[0];
    const dayBefore = new Date(first.date.getTime() - 24 * 60 * 60 * 1000);
    const byDay = new Map<number, StatementBalance>();
    byDay.set(dayBefore.getTime(), {
        date: endOfDay(dayBefore),
        balance: Math.round((first.balance! - first.amount) * 100) / 100 + 0,
    });
    for (const row of chronological) {
        byDay.set(row.date.getTime(), {date: endOfDay(row.date), balance: row.balance!});
    }
    return [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}
