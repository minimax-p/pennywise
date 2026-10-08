import {requireUser} from "@/lib/actionResult";
import prisma from "@/lib/prisma";
import {personBalances} from "@/lib/people";
import {currencyFormatter, toTransactionRow, transactionRowInclude} from "@/lib/transactionRows";

export const dynamic = "force-dynamic";

// One person: what they owe and every transaction with them, including split shares
export async function GET(_request: Request, {params}: { params: { id: string } }) {
    const user = await requireUser();
    const person = await prisma.person.findFirst({where: {id: params.id, userId: user.id}});
    if (!person) return Response.json({error: "Not found"}, {status: 404});
    const [balances, transactions, formatter] = await Promise.all([
        personBalances(user.id),
        prisma.transaction.findMany({
            where: {userId: user.id, OR: [{personId: person.id}, {lines: {some: {personId: person.id}}}]},
            include: transactionRowInclude,
            orderBy: [{date: "desc"}, {createdAt: "desc"}],
            take: 200,
        }),
        currencyFormatter(user.id),
    ]);
    return Response.json({
        person: {id: person.id, name: person.name, aliases: person.aliases},
        balance: balances.get(person.id) ?? 0,
        transactions: transactions.map((t) => toTransactionRow(t, formatter)),
    });
}

export type GetPersonResponseType = {
    person: { id: string, name: string, aliases: string[] },
    balance: number,
    transactions: ReturnType<typeof toTransactionRow>[],
};
