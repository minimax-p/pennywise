import {Account, Prisma} from "@prisma/client";
import prisma from "@/lib/prisma";

// Net effect of transactions on an account: income adds, expenses subtract,
// transfers subtract from the source account and add to the destination.
export async function getNetFlow(
    db: Prisma.TransactionClient,
    accountId: string,
    after?: Date,
): Promise<number> {
    const date = after ? {gt: after} : undefined;
    const [byType, transfersIn] = await Promise.all([
        db.transaction.groupBy({
            by: ["type"],
            where: {accountId, date},
            _sum: {amount: true},
        }),
        db.transaction.aggregate({
            where: {toAccountId: accountId, type: "transfer", date},
            _sum: {amount: true},
        }),
    ]);
    const sum = (type: string) => byType.find((row) => row.type === type)?._sum.amount ?? 0;
    return sum("income") - sum("expense") - sum("transfer") + (transfersIn._sum.amount ?? 0);
}

export async function getBalance(account: Account): Promise<number> {
    const balance = account.knownBalance + await getNetFlow(prisma, account.id, account.knownBalanceDate);
    // "+ 0" turns -0 into 0
    return Math.round(balance * 100) / 100 + 0;
}

// Universal category that every transfer is filed under
export async function getTransferCategory(db: Prisma.TransactionClient = prisma) {
    const existing = await db.category.findFirst({where: {type: "transfer", isUniversal: true}});
    return existing ?? db.category.create({
        data: {name: "Transfer", icon: "🔁", type: "transfer", isUniversal: true},
    });
}

// Throws unless every id is an account owned by the user
export async function assertOwnAccounts(userId: string, ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return;
    const found = await prisma.account.count({where: {userId, id: {in: wanted}}});
    if (found !== wanted.length) {
        throw new Error("Account not found");
    }
}
