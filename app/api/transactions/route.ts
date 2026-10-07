import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import {OverviewQuerySchema} from "@/schema/overview";
import prisma from "@/lib/prisma";
import {GetFormatterForCurrency} from "@/lib/helpers";

export async function GET(request: Request) {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    const {searchParams} = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const queryParams = OverviewQuerySchema.safeParse({from, to});
    if (!queryParams.success) {
        return Response.json(queryParams.error.message, {status: 400});
    }

    const transactions = await getTransactionsHistory(user.id, queryParams.data.from, queryParams.data.to);
    return Response.json(transactions);
}

export type GetTransactionsHistoryResponseType = Awaited<ReturnType<typeof getTransactionsHistory>>

async function getTransactionsHistory(userId: string, from: Date, to: Date) {
    const userSettings = await prisma.userSettings.findUnique({where: {userId}});
    const formatter = GetFormatterForCurrency(userSettings?.currency ?? 'USD');

    const transactions = await prisma.transaction.findMany({
        where: {
            userId,
            date: {
                gte: from,
                lte: to,
            },
        },
        include: {
            category: {select: {name: true, icon: true}},
            plaidItem: {select: {institutionName: true}},
            account: {select: {name: true}},
            toAccount: {select: {name: true}},
        },
        orderBy: [{date: 'desc'}, {createdAt: 'desc'}],
    });

    return transactions.map((transaction) => ({
        id: transaction.id,
        amount: transaction.amount,
        formattedAmount: formatter.format(transaction.amount),
        description: transaction.description,
        date: transaction.date,
        type: transaction.type,
        category: transaction.category,
        accountId: transaction.accountId,
        accountName: transaction.account?.name ?? null,
        // Transfers only
        toAccountId: transaction.toAccountId,
        toAccountName: transaction.toAccount?.name ?? null,
        // manual, import, apple_pay or plaid
        entrySource: transaction.source,
        // Name of the bank it was imported from through Plaid, null otherwise
        source: transaction.plaidTransactionId
            ? transaction.plaidItem?.institutionName ?? 'Bank'
            : null,
    }));
}
