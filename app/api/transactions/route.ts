import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import {OverviewQuerySchema} from "@/schema/overview";
import prisma from "@/lib/prisma";
import {currencyFormatter, toTransactionRow, TransactionRow, transactionRowInclude} from "@/lib/transactionRows";

export async function GET(request: Request) {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    const {searchParams} = new URL(request.url);
    const queryParams = OverviewQuerySchema.safeParse({from: searchParams.get('from'), to: searchParams.get('to')});
    if (!queryParams.success) {
        return Response.json(queryParams.error.message, {status: 400});
    }

    return Response.json(await getTransactionsHistory(user.id, queryParams.data.from, queryParams.data.to));
}

export type GetTransactionsHistoryResponseType = TransactionRow[];

async function getTransactionsHistory(userId: string, from: Date, to: Date): Promise<TransactionRow[]> {
    const formatter = await currencyFormatter(userId);
    const transactions = await prisma.transaction.findMany({
        where: {userId, date: {gte: from, lte: to}},
        include: transactionRowInclude,
        orderBy: [{date: 'desc'}, {createdAt: 'desc'}],
    });
    return transactions.map((t) => toTransactionRow(t, formatter));
}
