import z from "zod";
import prisma from "@/lib/prisma";
import {findAccountForCard, hashCaptureToken, parseShortcutDate} from "@/lib/capture";
import {parseAmount} from "@/lib/import/parse";
import {suggestCategoryName} from "@/lib/import/categories";
import {applyHistoryChanges} from "@/lib/history";
import {payeeKey} from "@/lib/payee";
import {DateToUTCDate, GetFormatterForCurrency} from "@/lib/helpers";
import {clearFailures, isLockedOut, recordFailure} from "@/lib/loginThrottle";

// Called by the Apple Pay automation in the Shortcuts app with a device key:
// POST /api/capture  Authorization: Bearer <key>  {"amount": "$4.50", "merchant": "Starbucks", "card": "Discover it"}

const CaptureSchema = z.object({
    amount: z.union([z.number(), z.string()]),
    merchant: z.string().trim().min(1).max(191),
    card: z.string().trim().max(191).optional(),
    // Optional; the server's clock (TZ) is used otherwise
    date: z.string().max(64).optional(),
});

function json(body: unknown, status: number) {
    return Response.json(body, {status});
}

export async function POST(request: Request) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const throttleKey = `capture:${ip}`;
    if (isLockedOut(throttleKey)) {
        return json({error: "Too many invalid keys. Try again later."}, 429);
    }

    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const key = token ? await prisma.captureToken.findUnique({where: {tokenHash: hashCaptureToken(token)}}) : null;
    if (!key) {
        recordFailure(throttleKey);
        return json({error: "Invalid or missing key"}, 401);
    }
    clearFailures(throttleKey);

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
    const date = parseShortcutDate(body.date) ?? DateToUTCDate(new Date());
    const accounts = await prisma.account.findMany({where: {userId}});
    const account = findAccountForCard(accounts, body.card);
    const settings = await prisma.userSettings.findUnique({where: {userId}});
    const formatter = GetFormatterForCurrency(settings?.currency ?? "USD");

    // Automations can fire twice for one tap
    const recent = await prisma.transaction.findFirst({
        where: {
            userId, source: "apple_pay", amount, description: body.merchant,
            createdAt: {gte: new Date(Date.now() - 2 * 60 * 1000)},
        },
        include: {category: true},
    });
    if (recent) {
        return json({id: recent.id, duplicate: true, message: `Already logged ${formatter.format(amount)} at ${body.merchant}`}, 200);
    }

    const [categoryName] = await suggestCategoryName(userId, [{
        date, amount: -amount, description: body.merchant, externalId: null, bankCategory: null, skipReason: null,
    }]);
    const category = await prisma.category.findFirst({
        where: {name: categoryName, type: "expense", OR: [{userId}, {isUniversal: true}]},
        orderBy: {isUniversal: "asc"},
    }) ?? await prisma.category.findFirst({where: {name: "Unsorted", type: "expense", isUniversal: true}})
        ?? await prisma.category.create({data: {name: "Unsorted", icon: "❓", type: "expense", isUniversal: true}});

    const transaction = await prisma.$transaction(async (tx) => {
        const created = await tx.transaction.create({
            data: {
                userId, amount, date, type: "expense", source: "apple_pay",
                description: body.merchant,
                payeeKey: payeeKey(body.merchant),
                categoryId: category.id,
                accountId: account?.id ?? null,
            },
        });
        await applyHistoryChanges(tx, userId, [{date, type: "expense", amount}]);
        await tx.captureToken.update({where: {id: key.id}, data: {lastUsedAt: new Date()}});
        return created;
    });

    return json({
        id: transaction.id,
        account: account?.name ?? null,
        category: category.name,
        message: `Logged ${formatter.format(amount)} at ${body.merchant}`
            + ` → ${category.icon} ${category.name}${account ? ` (${account.name})` : ""}`,
    }, 201);
}
