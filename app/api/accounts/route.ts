import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";
import {getBalance} from "@/lib/accounts";

export async function GET() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    const accounts = await getAccounts(user.id);
    return Response.json(accounts);
}

export type GetAccountsResponseType = Awaited<ReturnType<typeof getAccounts>>

async function getAccounts(userId: string) {
    const accounts = await prisma.account.findMany({
        where: {userId},
        orderBy: [{archived: 'asc'}, {createdAt: 'asc'}],
        select: {
            id: true,
            name: true,
            type: true,
            institution: true,
            walletCardName: true,
            archived: true,
            knownBalance: true,
            knownBalanceDate: true,
            createdAt: true,
            updatedAt: true,
            userId: true,
            importSettings: true,
            _count: {select: {transactions: true, incomingTransfers: true}},
        },
    });

    return Promise.all(accounts.map(async ({_count, ...account}) => ({
        ...account,
        balance: await getBalance(account),
        transactionCount: _count.transactions + _count.incomingTransfers,
    })));
}
