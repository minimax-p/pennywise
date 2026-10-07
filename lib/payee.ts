import {parseZelle} from "@/lib/import/zelle";

// Turns bank descriptions like "SQ *BLUE BOTTLE COFFEE #123 OAKLAND CA" and
// Apple Pay merchant names like "Blue Bottle Coffee" into comparable keys.

// Payment processor prefixes that come before the real merchant name
const PREFIXES = /^(?:POS |DEBIT CARD PURCHASE |PURCHASE AUTHORIZED ON \d\d\/\d\d |CHECKCARD |APLPAY |APPLE PAY |SQ \*|SQ\*|TST\* ?|SP \* ?|SP\* ?|PAYPAL \*|PP\*|IN \*|DD \*|DOORDASH\*)/;

const STOPWORDS = new Set([
    "THE", "AND", "INC", "LLC", "LTD", "CO", "CORP", "COM", "WWW", "STORE", "STORES", "SHOP", "STE",
    "PURCHASE", "PAYMENT", "DEBIT", "CREDIT", "CARD", "ONLINE", "RECURRING", "PENDING", "POS",
]);

const US_STATES = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ "
    + "NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split(" "));

export function payeeTokens(description: string): string[] {
    let text = description.toUpperCase().trim();
    // Prefixes can stack, e.g. "POS SQ *COFFEE"
    for (let i = 0; i < 3 && PREFIXES.test(text); i++) {
        text = text.replace(PREFIXES, "");
    }
    const raw = text.split(/[^A-Z0-9&]+/).filter(Boolean);
    // Banks append a store number and then the city, so stop at the first number
    const firstNumber = raw.findIndex((t) => /\d/.test(t));
    const tokens = firstNumber > 0 ? raw.slice(0, firstNumber) : raw.filter((t) => !/\d/.test(t));
    while (tokens.length > 1 && US_STATES.has(tokens[tokens.length - 1])) {
        tokens.pop();
    }
    const meaningful = tokens.filter((t) => t.length > 1 && !STOPWORDS.has(t));
    return meaningful.length > 0 ? meaningful : tokens;
}

// The first two meaningful words, e.g. "BLUE BOTTLE". Null when there is nothing to go on.
// Zelle payments are told apart by the person, e.g. "ZELLE TO SANG DAO", since "Zelle payment
// to" alone would lump everyone you pay together.
export function payeeKey(description: string): string | null {
    const zelle = parseZelle(description);
    if (zelle) {
        const name = zelle.name.toUpperCase().split(/\s+/).map((w) => w.replace(/[^A-Z]/g, "")).filter(Boolean).slice(0, 2);
        if (name.length > 0) return `ZELLE ${zelle.direction.toUpperCase()} ${name.join(" ")}`;
    }
    const tokens = payeeTokens(description);
    return tokens.length > 0 ? tokens.slice(0, 2).join(" ") : null;
}

// True when two descriptions plausibly name the same merchant
export function payeesSimilar(a: string, b: string): boolean {
    // Zelle payments are only the same when they're with the same person
    if (parseZelle(a) || parseZelle(b)) return payeeKey(a) === payeeKey(b);
    const [ta, tb] = [payeeTokens(a), payeeTokens(b)];
    if (ta.length === 0 || tb.length === 0) return false;
    return ta[0] === tb[0] || ta.join("").startsWith(tb.join("")) || tb.join("").startsWith(ta.join(""));
}
