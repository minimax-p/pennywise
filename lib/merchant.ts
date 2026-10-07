import {parseZelle} from "@/lib/import/zelle";
import {displayName} from "@/lib/people";

// Readable names for bank lines: "WAL-MART #2131    MIDDLETOWN NY" shows as "Walmart",
// "SQ *BLUE BOTTLE COFFEE 0412" as "Blue Bottle Coffee", "Zelle payment to DANA PARK
// JPM99abc" as "Zelle to Dana Park". The bank's text is kept as the description; this is
// only what lists show.

// Well-known chains whose statement spelling differs from their name
const BRANDS: [RegExp, string][] = [
    [/^(WAL-?MART|WM SUPERCENTER|WALMART)/, "Walmart"],
    [/^(AMZN|AMAZON)\b.*\b(PRIME|DIGITAL)/, "Amazon Prime"],
    [/^(AMZN|AMAZON)/, "Amazon"],
    [/^UBER\s*\*?\s*EATS/, "Uber Eats"],
    [/^UBER\b/, "Uber"],
    [/^LYFT\b/, "Lyft"],
    [/^DOORDASH|^DD \*?DOORDASH/, "DoorDash"],
    [/^GRUBHUB/, "Grubhub"],
    [/^INSTACART/, "Instacart"],
    [/^STARBUCKS/, "Starbucks"],
    [/^MCDONALD/, "McDonald's"],
    [/^DUNKIN/, "Dunkin'"],
    [/^CHIPOTLE/, "Chipotle"],
    [/^CHICK-?FIL-?A/, "Chick-fil-A"],
    [/^TRADER JOE/, "Trader Joe's"],
    [/^(WHOLEFDS|WHOLE FOODS)/, "Whole Foods"],
    [/^TARGET\b/, "Target"],
    [/^COSTCO/, "Costco"],
    [/^CVS\b/, "CVS"],
    [/^WALGREENS/, "Walgreens"],
    [/^7-?ELEVEN/, "7-Eleven"],
    [/^SHELL\b/, "Shell"],
    [/^(EXXON|EXXONMOBIL)/, "Exxon"],
    [/^NETFLIX/, "Netflix"],
    [/^SPOTIFY/, "Spotify"],
    [/^HULU/, "Hulu"],
    [/^(APPLE\.COM|APPLE COM)/, "Apple"],
    [/^GOOGLE\b/, "Google"],
    [/^PAYPAL\b/, "PayPal"],
    [/^VENMO\b/, "Venmo"],
    [/^(MTA|OMNY)\b/, "MTA"],
];

// Payment processor prefixes before the real name, as in lib/payee.ts
const PREFIXES = /^(?:POS |DEBIT CARD PURCHASE |PURCHASE AUTHORIZED ON \d\d\/\d\d |CHECKCARD |APLPAY |APPLE PAY |SQ \*|SQ\*|TST\* ?|SP \* ?|SP\* ?|PAYPAL \*|PP\*|IN \*|DD \*)/;

const US_STATES = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ "
    + "NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split(" "));

const SMALL_WORDS = new Set(["and", "of", "the", "at", "on", "in", "for", "to"]);
const ACRONYMS = new Set(["ATM", "ACH", "CVS", "IRS", "DMV", "USPS", "UPS", "NYC", "USA", "BP", "TJ", "HBO", "AT&T", "LLC"]);

function titleCase(text: string) {
    return text.split(" ").map((word, i) => {
        if (ACRONYMS.has(word)) return word;
        const lower = word.toLowerCase();
        if (i > 0 && SMALL_WORDS.has(lower)) return lower;
        return lower.replace(/(^|[-'&])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
    }).join(" ");
}

// Up to the first store number, reference or phone number
function beforeReference(words: string[]) {
    const end = words.findIndex((w, i) => i > 0 && (/\d{2,}/.test(w) || w.startsWith("#") || w.startsWith("*") || w.startsWith("...")));
    return end > 0 ? words.slice(0, end) : words;
}

export function cleanMerchant(description: string): string {
    const original = description.trim();
    if (!original) return original;

    const zelle = parseZelle(original);
    if (zelle) return `Zelle ${zelle.direction} ${displayName(zelle.name)}`;

    // Banks pad the name and put the city after a wide gap
    const padded = original.replace(/\s+\*/g, " *");
    // Mixed case means a person or an app already wrote it nicely
    if (original !== original.toUpperCase()) {
        const kept = beforeReference(padded.split(/\s{2,}/)[0].split(/\s+/)).join(" ").trim();
        const brand = BRANDS.find(([pattern]) => pattern.test(kept.toUpperCase()));
        return brand ? brand[1] : kept || original;
    }
    let text = padded.split(/\s{2,}/)[0];
    for (let i = 0; i < 3 && PREFIXES.test(text); i++) text = text.replace(PREFIXES, "");
    text = text.trim();

    const brand = BRANDS.find(([pattern]) => pattern.test(text));
    if (brand) return brand[1];

    let kept = beforeReference(text.split(/\s+/));
    while (kept.length > 1 && US_STATES.has(kept[kept.length - 1])) kept = kept.slice(0, -1);
    const name = kept.join(" ").replace(/[*#]+$/, "").trim();
    return name ? titleCase(name) : original;
}

// What a transaction is called in lists: your own name for it, or for statement lines a
// cleaned-up version of the bank's text
export function merchantName(t: { description: string, merchant: string | null, source: string }) {
    if (t.merchant) return t.merchant;
    if (t.source === "import" || t.source === "plaid") return cleanMerchant(t.description);
    return t.description;
}

// Editing the name of a statement line renames it and keeps the bank's text; for anything
// you logged, the name is the description
export function nameFields(existing: { description: string, merchant: string | null, source: string } | null, typed: string) {
    const name = typed.trim();
    if (!existing || (existing.source !== "import" && existing.source !== "plaid")) {
        return {description: name, merchant: existing?.merchant ?? null};
    }
    if (name === merchantName(existing)) return {description: existing.description, merchant: existing.merchant};
    return {description: existing.description, merchant: name && name !== cleanMerchant(existing.description) ? name : null};
}
