// Reads the person out of bank lines like "Zelle payment to JOHN SMITH JPM99cp7nm8d"
// or "Zelle payment from JOHN SMITH COF7P5Z7RRZO", to recognize money you send yourself.

export type ZelleLine = {
    direction: "to" | "from";
    name: string;
    // Confirmation code at the end; for money received its prefix names the sender's bank
    code: string | null;
};

export function parseZelle(description: string): ZelleLine | null {
    const match = description.match(/\bzelle\b.*?\b(to|from)\s+(.+?)\s*$/i);
    if (!match) return null;
    const words = match[2].split(/\s+/);
    const code = words.length > 1 && /\d/.test(words[words.length - 1]) ? words.pop()! : null;
    const name = words.join(" ").trim();
    return name ? {direction: match[1].toLowerCase() as ZelleLine["direction"], name, code} : null;
}

const BANK_CODES: [RegExp, string][] = [
    [/^COF/i, "Capital One"],
    [/^BAC/i, "Bank of America"],
    [/^WFC/i, "Wells Fargo"],
    [/^JPM/i, "Chase"],
    [/^CTI/i, "Citi"],
    [/^PNC/i, "PNC"],
    [/^USB/i, "U.S. Bank"],
];

export function bankFromCode(code: string | null): string | null {
    if (!code) return null;
    return BANK_CODES.find(([pattern]) => pattern.test(code))?.[1] ?? null;
}

const nameTokens = (name: string) => name.toUpperCase().replace(/[^A-Z]+/g, " ").trim().split(" ").filter(Boolean);

// The "selfNames" setting: comma separated. Single words are ignored, since a first
// name alone would match other people.
export function parseSelfNames(setting: string | null | undefined): string[][] {
    return (setting ?? "").split(",").map(nameTokens).filter((tokens) => tokens.length >= 2);
}

// True when every word of one of your names appears in the name on the line
export function isSelf(name: string, selfNames: string[][]): boolean {
    const tokens = new Set(nameTokens(name));
    return selfNames.some((self) => self.every((t) => tokens.has(t)));
}
