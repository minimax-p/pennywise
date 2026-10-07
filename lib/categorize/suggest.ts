import prisma from "@/lib/prisma";
import {payeeKey} from "@/lib/payee";
import {loadRules, matchRule} from "@/lib/rules";
import {Alternative, askJev, AUTO_ACCEPT_CONFIDENCE, CategoryOption, jevEnabled, JevContext, PastChoice} from "@/lib/categorize/jev";

// Picks a category for new transactions, most trusted source first:
// 1. your rules
// 2. what you chose before for the same merchant
// 3. the category the bank put in its export
// 4. keywords like PAYROLL or NETFLIX
// 5. Jev, when TYPESAFE_API_KEY is set
// Anything left is Unsorted and waits on the Sort page.

export type CategorySource = "rule" | "history" | "bank" | "keyword" | "ai" | "none";

export type CategorySuggestion = {
    name: string;
    source: CategorySource;
    // Jev's confidence, for AI suggestions
    confidence: number | null;
    // Jev's most likely categories, offered on the Sort page
    alternatives: Alternative[] | null;
    // A rule's name for the merchant
    rename?: string | null;
};

export type SuggestInput = {
    description: string;
    // Positive when money came in
    amount: number;
    date: Date;
    bankCategory: string | null;
    accountName?: string | null;
    accountType?: string | null;
    // The person on the line, for rules about people
    person?: string | null;
    personId?: string | null;
};

// Categories below are keys of the built-in categories in prisma/categories.mjs, so they keep
// working after you rename one

// Categories Chase, Discover and Capital One card exports put in their Category column
const BANK_CATEGORIES: Record<string, string> = {
    // Chase
    "FOOD & DRINK": "eating-out",
    "GROCERIES": "groceries",
    "GAS": "gas",
    "SHOPPING": "shopping",
    "ENTERTAINMENT": "fun",
    "BILLS & UTILITIES": "utilities",
    "HEALTH & WELLNESS": "health",
    "PERSONAL": "personal-care",
    "HOME": "household",
    "AUTOMOTIVE": "car",
    "TRAVEL": "travel",
    "GIFTS & DONATIONS": "gifts",
    "EDUCATION": "education",
    "FEES & ADJUSTMENTS": "fees",
    // Discover
    "RESTAURANTS": "eating-out",
    "SUPERMARKETS": "groceries",
    "GASOLINE": "gas",
    "MERCHANDISE": "shopping",
    "DEPARTMENT STORES": "shopping",
    "HOME IMPROVEMENT": "household",
    "MEDICAL SERVICES": "health",
    "TRAVEL/ ENTERTAINMENT": "fun",
    "AUTOMOTIVE ": "car",
    "SERVICES": "household",
    "GOVERNMENT SERVICES": "taxes",
    // Capital One
    "DINING": "eating-out",
    "GAS/AUTOMOTIVE": "gas",
    "HEALTH CARE": "health",
    "MERCHANDISE & SUPPLIES": "shopping",
    "PHONE/CABLE": "phone-internet",
    "UTILITIES": "utilities",
    "ENTERTAINMENT ": "fun",
    "LODGING": "travel",
    "AIRFARE": "travel",
};

// Well-known chains and words; only names that mean the same thing for everyone
const KEYWORD_RULES: { pattern: RegExp, income: boolean, key: string }[] = [
    {
        pattern: /\b(OVERDRAFT|NSF|INSUFFICIENT FUNDS|SERVICE|MAINTENANCE|MONTHLY|WIRE|ATM|FOREIGN (TRANSACTION|EXCHANGE)|LATE( PAYMENT)?|RETURNED (ITEM|PAYMENT)|ANNUAL( MEMBERSHIP)?|CASH ADVANCE)\s+FEE|\bFEE FOR\b|ATM SURCHARGE|INTEREST CHARGE|PURCHASE INTEREST/i,
        income: false, key: "fees",
    },
    {pattern: /PAYROLL|DIRECT DEP|DIR DEP|SALARY/i, income: true, key: "paycheck"},
    {pattern: /INTEREST|DIVIDEND/i, income: true, key: "interest"},
    {pattern: /CASHBACK|CASH BACK|REWARD/i, income: true, key: "interest"},
    {pattern: /\bIRS\b|TREAS TAX|TAX PYMT|STATE TAX|DMV|USCIS|PASSPORT/i, income: false, key: "taxes"},
    {pattern: /UBER\s*\*?\s*EATS|DOORDASH|GRUBHUB|SEAMLESS|POSTMATES/i, income: false, key: "eating-out"},
    {pattern: /UBER\b|LYFT|\bMTA\b|OMNY|NJ TRANSIT|AMTRAK|METRO ?CARD|CLIPPER|VENTRA|SEPTA|WMATA/i, income: false, key: "rides"},
    {pattern: /STARBUCKS|DUNKIN|TIM HORTONS|DUTCH BROS|PEET'?S|BOBA|BUBBLE TEA|KUNG FU TEA|GONG CHA|\bCHATIME|TEAVANA/i, income: false, key: "coffee-snacks"},
    {pattern: /MCDONALD|BURGER KING|WENDY'?S|TACO BELL|\bKFC\b|CHIPOTLE|SUBWAY|CHICK-?FIL-?A|POPEYES|PANERA|DOMINO'?S|PIZZA HUT|PAPA JOHN|FIVE GUYS|SHAKE SHACK|PANDA EXPRESS|SWEETGREEN|\bPHO\b|RAMEN|SUSHI|PIZZA|GRILL|DINER|BURRITO|TAQUERIA|RESTAURANT|KITCHEN|CAFE\b/i, income: false, key: "eating-out"},
    {pattern: /WAL-?MART|WM SUPERCENTER|SAMS ?CLUB|SAM'S CLUB|COSTCO|BJ'?S WHOLESALE|SHOPRITE|STOP ?& ?SHOP|TRADER JOE|WHOLE ?FOODS|WHOLEFDS|ALDI|KROGER|SAFEWAY|PUBLIX|WEGMANS|HANNAFORD|FOOD LION|GIANT EAGLE|H-E-B|HMART|H MART|99 RANCH|SUPERMARKET|GROCERY|MARKET BASKET|INSTACART/i, income: false, key: "groceries"},
    {pattern: /SHELL\b|EXXON|MOBIL\b|\bBP\b|CHEVRON|SUNOCO|SPEEDWAY|CITGO|VALERO|MARATHON PETRO|GULF OIL|WAWA|QUICKCHEK|MURPHY USA|CIRCLE K/i, income: false, key: "gas"},
    {pattern: /PROGRESSIVE|GEICO|STATE FARM|ALLSTATE|JIFFY LUBE|VALVOLINE|\bVIOC\b|MIDAS|PEP BOYS|AUTOZONE|ADVANCE AUTO|PARKING|PARKMOBILE|E-?Z ?PASS|TOLL/i, income: false, key: "car"},
    {pattern: /VERIZON|T-MOBILE|AT&T|\bVISIBLE\b|MINT MOBILE|CRICKET|BOOST MOBILE|SPECTRUM|XFINITY|COMCAST|OPTIMUM|FIOS/i, income: false, key: "phone-internet"},
    {pattern: /CON ?ED|NATIONAL GRID|PSE&G|PG&E|DUKE ENERGY|ELECTRIC|WATER DEPT|GAS & ELECTRIC/i, income: false, key: "utilities"},
    {pattern: /NETFLIX|HULU|DISNEY ?PLUS|DISNEYPLUS|HBO|MAX\.COM|YOUTUBE PREMIUM|SPOTIFY|APPLE\.COM\/BILL|APPLE MUSIC|ICLOUD|AMAZON PRIME|PRIME VIDEO|AUDIBLE|PARAMOUNT|PEACOCK|CRUNCHYROLL|OPENAI|CHATGPT|ANTHROPIC|CLAUDE\.AI|GITHUB|DROPBOX|GOOGLE \*?(STORAGE|ONE)|ADOBE|MICROSOFT/i, income: false, key: "subscriptions"},
    {pattern: /\bAMC\b|REGAL|CINEMA|FANDANGO|TICKETMASTER|STUBHUB|STEAM ?GAMES|PLAYSTATION|NINTENDO|XBOX|BOWLING/i, income: false, key: "fun"},
    {pattern: /CVS|WALGREENS|RITE AID|PHARMACY|DENTAL|MEDICAL|HOSPITAL|CLINIC|URGENT CARE|PLANET FITNESS|GYM\b/i, income: false, key: "health"},
    {pattern: /GREAT CLIPS|SUPERCUTS|BARBER|SALON|SEPHORA|ULTA/i, income: false, key: "personal-care"},
    {pattern: /AIRBNB|EXPEDIA|BOOKING\.COM|HOTEL|MARRIOTT|HILTON|DELTA AIR|UNITED AIR|AMERICAN AIR|JETBLUE|SOUTHWEST|SPIRIT AIR|FRONTIER AIR/i, income: false, key: "travel"},
    {pattern: /HOME DEPOT|LOWE'?S|IKEA|BED BATH|DOLLAR ?TREE|DOLLAR GENERAL|FAMILY DOLLAR/i, income: false, key: "household"},
    {pattern: /AMAZON|AMZN|TARGET\b|BEST BUY|TEMU|SHEIN|EBAY|ETSY|MACY'?S|TJ ?MAXX|MARSHALLS|NIKE|UNIQLO|OLD NAVY|APPLE STORE/i, income: false, key: "shopping"},
    {pattern: /TUITION|UNIVERSITY|COLLEGE|COURSERA|UDEMY/i, income: false, key: "education"},
];

// Only categories you picked (or confirmed) teach future suggestions, so an AI guess
// you never looked at can't spread to other transactions
export const TRUSTED_CATEGORY = {
    needsReview: false,
    OR: [{categorizedBy: null}, {categorizedBy: {in: ["you", "history", "rule"]}}],
    // A split's parts are in its lines, not in one category to suggest
    category: {type: {in: ["income", "expense"]}},
};

export function needsReview(suggestion: CategorySuggestion) {
    return suggestion.name === "Unsorted"
        || suggestion.source === "none"
        || (suggestion.source === "ai" && (suggestion.confidence ?? 0) < AUTO_ACCEPT_CONFIDENCE);
}

// What to store on a transaction filed under this suggestion
export function categorizationFields(suggestion: CategorySuggestion) {
    return {
        needsReview: needsReview(suggestion),
        categorizedBy: suggestion.source === "none" ? null : suggestion.source,
        categoryConfidence: suggestion.source === "ai" ? suggestion.confidence : null,
        ...(suggestion.alternatives && {aiSuggestions: suggestion.alternatives}),
    };
}

async function loadJevContext(userId: string): Promise<JevContext> {
    const categories = await prisma.category.findMany({
        where: {OR: [{userId}, {isUniversal: true}], type: {in: ["income", "expense"]}, hidden: false, NOT: {name: "Unsorted"}},
        orderBy: [{sortOrder: "asc"}, {name: "asc"}],
    });
    const recent = await prisma.transaction.findMany({
        where: {userId, type: {in: ["income", "expense"]}, payeeKey: {not: null}, ...TRUSTED_CATEGORY},
        orderBy: {date: "desc"},
        take: 300,
        select: {payeeKey: true, type: true, category: {select: {name: true}}},
    });

    const options = (type: string): CategoryOption[] =>
        categories.filter((c) => c.type === type).map((c) => ({name: c.name, group: c.group}));
    // Your most recent choice for each merchant
    const pastChoices = (type: string): PastChoice[] => {
        const byMerchant = new Map<string, string>();
        for (const t of recent) {
            if (t.type === type && t.category.name !== "Unsorted" && !byMerchant.has(t.payeeKey!)) {
                byMerchant.set(t.payeeKey!, t.category.name);
            }
        }
        return [...byMerchant].map(([merchant, category]) => ({merchant, category}));
    };

    return {
        categories: {income: options("income"), expense: options("expense")},
        pastChoices: {income: pastChoices("income"), expense: pastChoices("expense")},
    };
}

// useAi says which inputs may go to Jev (e.g. not lines that will become transfers)
export async function suggestCategories(
    userId: string,
    inputs: SuggestInput[],
    useAi: (index: number) => boolean = () => true,
): Promise<CategorySuggestion[]> {
    const keys = inputs.map((r) => payeeKey(r.description));
    const wanted = [...new Set(keys.filter((k): k is string => k !== null))];

    const learned = new Map<string, string>();
    if (wanted.length > 0) {
        const past = await prisma.transaction.findMany({
            where: {userId, payeeKey: {in: wanted}, type: {in: ["income", "expense"]}, ...TRUSTED_CATEGORY},
            orderBy: {date: "desc"},
            select: {payeeKey: true, type: true, category: {select: {name: true}}},
        });
        for (const t of past) {
            const key = `${t.type}:${t.payeeKey}`;
            if (!learned.has(key) && t.category.name !== "Unsorted") learned.set(key, t.category.name);
        }
    }

    const rules = await loadRules(userId);
    // Built-in categories you haven't hidden, by key, under their current names
    const builtIn = await prisma.category.findMany({where: {key: {not: null}, hidden: false}, select: {key: true, name: true}});
    const nameOfKey = (key: string | undefined) => key ? builtIn.find((c) => c.key === key)?.name : undefined;

    const suggestions = inputs.map((input, i): CategorySuggestion => {
        const income = input.amount > 0;
        const type = income ? "income" : "expense";
        const rule = matchRule(rules, {description: input.description, type, person: input.person, personId: input.personId});
        const none = {confidence: null, alternatives: null, rename: rule?.rename ?? null};
        if (rule?.category && rule.category.type === type) return {name: rule.category.name, source: "rule", ...none};
        const fromHistory = keys[i] && learned.get(`${income ? "income" : "expense"}:${keys[i]}`);
        if (fromHistory) return {name: fromHistory, source: "history", ...none};
        if (!income && input.bankCategory) {
            const fromBank = nameOfKey(BANK_CATEGORIES[input.bankCategory.trim().toUpperCase()]);
            if (fromBank) return {name: fromBank, source: "bank", ...none};
        }
        const keyword = nameOfKey(KEYWORD_RULES.find((r) => r.income === income && r.pattern.test(input.description))?.key);
        if (keyword) return {name: keyword, source: "keyword", ...none};
        return {name: "Unsorted", source: "none", ...none};
    });

    // Ask Jev once per merchant and direction for whatever is still unsorted
    if (jevEnabled()) {
        const groups = new Map<string, number[]>();
        suggestions.forEach((s, i) => {
            if (s.source !== "none" || !useAi(i)) return;
            const groupKey = `${inputs[i].amount > 0 ? "in" : "out"}:${keys[i] ?? inputs[i].description.toUpperCase()}`;
            groups.set(groupKey, [...(groups.get(groupKey) ?? []), i]);
        });
        if (groups.size > 0) {
            const representatives = [...groups.values()].map((indexes) => indexes[0]);
            const answers = await askJev(representatives.map((i) => ({
                description: inputs[i].description,
                amount: inputs[i].amount,
                date: inputs[i].date,
                bankCategory: inputs[i].bankCategory,
                accountName: inputs[i].accountName ?? null,
                accountType: inputs[i].accountType ?? null,
            })), await loadJevContext(userId));
            [...groups.values()].forEach((indexes, g) => {
                const answer = answers[g];
                if (!answer) return;
                for (const i of indexes) {
                    suggestions[i] = {
                        name: answer.name, source: "ai", confidence: answer.confidence, alternatives: answer.alternatives,
                        rename: suggestions[i].rename,
                    };
                }
            });
        }
    }

    return suggestions;
}
