import {Prisma} from "@prisma/client";
import prisma from "@/lib/prisma";
import {GetFormatterForCurrency} from "@/lib/helpers";

// The fields every transaction list (Transactions, Home, account pages, Sort) shows

export const transactionRowInclude = {
    category: {select: {name: true, icon: true, type: true}},
    plaidItem: {select: {institutionName: true}},
    account: {select: {name: true}},
    toAccount: {select: {name: true}},
} satisfies Prisma.TransactionInclude;

type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof transactionRowInclude }>;

export function toTransactionRow(transaction: TransactionWithRelations, formatter: Intl.NumberFormat) {
    return {
        id: transaction.id,
        amount: transaction.amount,
        formattedAmount: formatter.format(transaction.amount),
        description: transaction.description,
        note: transaction.note,
        date: transaction.date,
        // income, expense, transfer or adjustment
        type: transaction.type,
        // The category's type tells a refund (money in, spending category) from income
        category: transaction.category,
        accountId: transaction.accountId,
        accountName: transaction.account?.name ?? null,
        // Transfers and adjustments into an account
        toAccountId: transaction.toAccountId,
        toAccountName: transaction.toAccount?.name ?? null,
        // manual, import, apple_pay or plaid
        entrySource: transaction.source,
        // Name of the bank it was imported from through Plaid, null otherwise
        source: transaction.plaidTransactionId
            ? transaction.plaidItem?.institutionName ?? 'Bank'
            : null,
        needsReview: transaction.needsReview,
    };
}

export type TransactionRow = ReturnType<typeof toTransactionRow>;

export async function currencyFormatter(userId: string) {
    const settings = await prisma.userSettings.findUnique({where: {userId}});
    return GetFormatterForCurrency(settings?.currency ?? 'USD');
}
