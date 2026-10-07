import {Prisma} from "@prisma/client";
import prisma from "@/lib/prisma";
import {GetFormatterForCurrency} from "@/lib/helpers";
import {merchantName} from "@/lib/merchant";

// The fields every transaction list (Transactions, Home, account pages, Sort) shows

export const transactionRowInclude = {
    category: {select: {name: true, icon: true, type: true}},
    plaidItem: {select: {institutionName: true}},
    account: {select: {name: true}},
    toAccount: {select: {name: true}},
    person: {select: {id: true, name: true}},
    lines: {
        orderBy: {position: "asc"},
        select: {
            amount: true,
            category: {select: {name: true, icon: true, type: true}},
            person: {select: {id: true, name: true}},
        },
    },
} satisfies Prisma.TransactionInclude;

type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof transactionRowInclude }>;

export function toTransactionRow(transaction: TransactionWithRelations, formatter: Intl.NumberFormat) {
    return {
        id: transaction.id,
        amount: transaction.amount,
        formattedAmount: formatter.format(transaction.amount),
        // The bank's text, or what you typed
        description: transaction.description,
        // What to call it: your rename, a cleaned-up statement line, or what you typed
        name: merchantName(transaction),
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
        // Zelle or Venmo counterparty, or the person you picked
        person: transaction.person,
        // A split's parts: your shares by category, other people's shares
        lines: transaction.lines,
    };
}

export type TransactionRow = ReturnType<typeof toTransactionRow>;

export async function currencyFormatter(userId: string) {
    const settings = await prisma.userSettings.findUnique({where: {userId}});
    return GetFormatterForCurrency(settings?.currency ?? 'USD');
}
