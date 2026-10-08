import z from "zod";
import prisma from "@/lib/prisma";
import {authenticateDevice, findAccountForCard, matchesCategoryLabel, parseShortcutDate, SORT_LATER} from "@/lib/capture";
import {parseAmount} from "@/lib/import/parse";
import {categorizationFields, suggestCategories} from "@/lib/categorize/suggest";
import {payeeKey} from "@/lib/payee";
import {DateToUTCDate, GetFormatterForCurrency} from "@/lib/helpers";
import {getUnsortedCategory} from "@/lib/entries";
import {getSpendingMoney} from "@/lib/home";

// Called by the iPhone shortcuts with a device key:
//
// The Apple Pay automation, after each Apple Pay purchase:
//   POST /api/capture  {"amount": "$4.50", "merchant": "Starbucks", "card": "Discover it"}
// The "Log a purchase" shortcut, with answers picked from GET /api/capture/options:
//   POST /api/capture  {"amount": "86.40", "merchant": "Walmart", "account": "Discover", "category": "🛒 Groceries"}

const CaptureSchema = z.object({
    amount: z.union([z.number(), z.string()]),
    merchant: z.string().trim().min(1).max(191),
    // Apple Wallet's card name, from the Apple Pay automation
    card: z.string().trim().max(191).optional(),
    // An account's name, from the Log a purchase shortcut
    account: z.string().trim().max(191).optional(),
    // A category name (with or without its emoji), or "Sort later"
    category: z.string().trim().max(191).optional(),
    note: z.string().trim().max(500).optional(),
    // Optional; the server's clock (TZ) is used otherwise
    date: z.string().max(64).optional(),
});

function json(body: unknown, status: number) {
    return Response.json(body, {status});
}

export async function POST(request: Request) {
    const auth = await authenticateDevice(request);
    if ("response" in auth) return auth.response;
    const {key} = auth;

    let body: z.infer<typeof CaptureSchema>;
    try {
        const parsed = CaptureSchema.safeParse(await request.json());
        if (!parsed.success) return json({error: "Send amount and merchant as JSON"}, 400);
        body = parsed.data;
    } catch {
        return json({error: "Send amount and merchant as JSON"}, 400);
    }

    const parsedAmount = typeof body.amount === "number" ? body.amount : parseAmount(body.amount);
    const amount = parsedAmount === null ? null : Math.round(Math.abs(parsedAmount) * 100) / 100;
    if (!amount) {
        return json({error: `Could not read the amount "${body.amount}"`}, 400);
    }

    const userId = key.userId;
    const fromApplePay = Boolean(body.card) || !body.account;
    const source = fromApplePay ? "apple_pay" : "shortcut";
    const date = parseShortcutDate(body.date) ?? DateToUTCDate(new Date());
    const accounts = await prisma.account.findMany({where: {userId}});
    const account = body.account
        ? accounts.find((a) => !a.archived && a.name.toLowerCase() === body.account!.toLowerCase()) ?? null
        : findAccountForCard(accounts, body.card);
    if (body.account && !account) {
        return json({error: `There is no account called "${body.account}"`}, 400);
    }
    const settings = await prisma.userSettings.findUnique({where: {userId}});
    const formatter = GetFormatterForCurrency(settings?.currency ?? "USD");

    // Automations can fire twice for one tap
    const recent = await prisma.transaction.findFirst({
        where: {
            userId, source, amount, description: body.merchant,
            createdAt: {gte: new Date(Date.now() - 2 * 60 * 1000)},
        },
    });
    if (recent) {
        return json({id: recent.id, duplicate: true, message: `Already logged ${formatter.format(amount)} at ${body.merchant}`}, 200);
    }

    // The category you picked, or one suggested from your history and keywords
    const later = body.category !== undefined && SORT_LATER.some((s) => s.toLowerCase() === body.category!.toLowerCase());
    const categories = await prisma.category.findMany({
        where: {type: "expense", OR: [{userId}, {isUniversal: true}]},
        orderBy: {isUniversal: "asc"},
    });
    let category = body.category && !later ? categories.find((c) => matchesCategoryLabel(c, body.category!)) : undefined;
    if (body.category && !later && !category) {
        return json({error: `There is no spending category called "${body.category}"`}, 400);
    }
    let fields: ReturnType<typeof categorizationFields> | { needsReview: boolean, categorizedBy: string | null } =
        {needsReview: false, categorizedBy: "you"};
    let rename: string | null = null;
    if (!category && !later) {
        const [suggestion] = await suggestCategories(userId, [{
            date, amount: -amount, description: body.merchant, bankCategory: null,
            accountName: account?.name ?? null, accountType: account?.type ?? null,
        }]);
        category = categories.find((c) => c.name === suggestion.name);
        if (category) fields = categorizationFields(suggestion);
        rename = suggestion.rename ?? null;
    }

    const transaction = await prisma.$transaction(async (tx) => {
        const filed = category ?? await getUnsortedCategory(tx, "expense");
        if (!category) fields = {needsReview: true, categorizedBy: null};
        const created = await tx.transaction.create({
            data: {
                userId, amount, date, type: "expense", source,
                description: body.merchant,
                payeeKey: payeeKey(body.merchant),
                categoryId: filed.id,
                accountId: account?.id ?? null,
                note: body.note || null,
                merchant: rename,
                ...fields,
            },
            include: {category: true},
        });
        await tx.captureToken.update({where: {id: key.id}, data: {lastUsedAt: new Date()}});
        return created;
    });

    const filed = transaction.category;
    const sorted = !transaction.needsReview;
    const spendingMoney = fromApplePay ? null : await getSpendingMoney(userId);
    return json({
        id: transaction.id,
        account: account?.name ?? null,
        category: filed.name,
        needsReview: transaction.needsReview,
        message: `Logged ${formatter.format(amount)} at ${body.merchant}`
            + (sorted ? ` → ${filed.icon} ${filed.name}` : "")
            + (account ? ` (${account.name})` : "")
            + (sorted ? "." : ". Sort it in Pennywise.")
            + (spendingMoney !== null ? ` Spending money is now ${formatter.format(spendingMoney)}.` : ""),
    }, 201);
}
