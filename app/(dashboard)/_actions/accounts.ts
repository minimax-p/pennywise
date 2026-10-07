"use server";

import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import prisma from "@/lib/prisma";
import {Account} from "@prisma/client";
import {
    CheckBalanceSchema,
    CheckBalanceSchemaType,
    CreateAccountSchema,
    CreateAccountSchemaType,
    DeleteAccountSchema,
    DeleteAccountSchemaType,
    DeleteBalanceCheckSchema,
    DeleteBalanceCheckSchemaType,
    EditAccountSchema,
    EditAccountSchemaType
} from "@/schema/account";
import {getAdjustmentCategory, loadLedger} from "@/lib/accounts";
import {CENT, roundMoney} from "@/lib/ledger";

// Expected failures are returned instead of thrown, because Next.js hides
// error messages thrown from server actions in production.
type ActionResult<T> = { ok: true, data: T } | { ok: false, error: string };

async function requireUser() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }
    return user;
}

async function nameTaken(userId: string, name: string, excludeId?: string) {
    const existing = await prisma.account.findFirst({
        where: {userId, name, ...(excludeId && {NOT: {id: excludeId}})},
    });
    return existing ? `An account named "${name}" already exists` : null;
}

export async function CreateAccount(form: CreateAccountSchemaType): Promise<ActionResult<Account>> {
    const parsedBody = CreateAccountSchema.safeParse(form);
    if (!parsedBody.success) {
        return {ok: false, error: parsedBody.error.issues[0]?.message ?? "Check the form"};
    }
    const user = await requireUser();
    const {name, type, institution, walletCardName, apy, maturesOn, balance, balanceDate} = parsedBody.data;
    const taken = await nameTaken(user.id, name);
    if (taken) return {ok: false, error: taken};

    // The starting balance is the account's first balance check
    const account = await prisma.account.create({
        data: {
            userId: user.id,
            name,
            type,
            institution,
            walletCardName,
            ...(type === "cd" ? {apy, maturesOn} : {}),
            balanceChecks: {create: {date: balanceDate, balance, source: "you"}},
        },
    });
    return {ok: true, data: account};
}

export async function EditAccount(form: EditAccountSchemaType): Promise<ActionResult<Account>> {
    const parsedBody = EditAccountSchema.safeParse(form);
    if (!parsedBody.success) {
        return {ok: false, error: parsedBody.error.issues[0]?.message ?? "Check the form"};
    }
    const user = await requireUser();
    const {id, ...data} = parsedBody.data;

    const account = await prisma.account.findFirst({where: {id, userId: user.id}});
    if (!account) return {ok: false, error: "Account not found"};
    const taken = await nameTaken(user.id, data.name, id);
    if (taken) return {ok: false, error: taken};

    const {apy, maturesOn, ...rest} = data;
    const cd = data.type === "cd" ? {apy, maturesOn} : {apy: null, maturesOn: null};
    return {ok: true, data: await prisma.account.update({where: {id}, data: {...rest, ...cd}})};
}

export type BalanceCheckResult = {
    // What Pennywise had for that moment, and the bank's number minus it
    expected: number;
    difference: number;
    // The check before this one, and how many transactions came in since
    previousCheckAt: string | null;
    transactionsSince: number;
    saved: boolean;
};

// Compares the balance the bank shows with Pennywise's, and saves it as a balance check
// when asked. Saved checks set the balance from then on; an adjustment can account for
// a difference nobody can explain, so the transactions add up again.
export async function CheckBalance(form: CheckBalanceSchemaType): Promise<ActionResult<BalanceCheckResult>> {
    const parsedBody = CheckBalanceSchema.safeParse(form);
    if (!parsedBody.success) {
        return {ok: false, error: parsedBody.error.issues[0]?.message ?? "Check the amount"};
    }
    const user = await requireUser();
    const {accountId, balance, balanceDate, save, adjust} = parsedBody.data;

    const account = await prisma.account.findFirst({where: {id: accountId, userId: user.id}});
    if (!account) return {ok: false, error: "Account not found"};

    const ledger = await loadLedger(accountId);
    const expected = ledger.balanceAt(balanceDate);
    const difference = roundMoney(balance - expected);
    const previous = await prisma.balanceCheck.findFirst({
        where: {accountId, date: {lte: balanceDate}},
        orderBy: [{date: "desc"}, {createdAt: "desc"}],
    });
    const transactionsSince = await prisma.transaction.count({
        where: {
            OR: [{accountId}, {toAccountId: accountId, type: {in: ["transfer", "adjustment"]}}],
            date: {lte: balanceDate, ...(previous ? {gt: previous.date} : {})},
        },
    });
    const result: BalanceCheckResult = {
        expected,
        difference,
        previousCheckAt: previous?.date.toISOString() ?? null,
        transactionsSince,
        saved: false,
    };
    if (!save) return {ok: true, data: result};

    const adjustmentCategory = adjust && Math.abs(difference) >= CENT ? await getAdjustmentCategory() : null;
    await prisma.$transaction(async (tx) => {
        if (adjustmentCategory) {
            await tx.transaction.create({
                data: {
                    userId: user.id,
                    amount: Math.abs(difference),
                    date: balanceDate,
                    description: "Balance adjustment",
                    type: "adjustment",
                    categoryId: adjustmentCategory.id,
                    // Money in when the bank has more than Pennywise
                    accountId: difference < 0 ? accountId : null,
                    toAccountId: difference > 0 ? accountId : null,
                },
            });
        }
        await tx.balanceCheck.create({data: {accountId, date: balanceDate, balance, source: "you"}});
    });
    return {ok: true, data: {...result, saved: true}};
}

export async function DeleteBalanceCheck(form: DeleteBalanceCheckSchemaType): Promise<ActionResult<null>> {
    const parsedBody = DeleteBalanceCheckSchema.safeParse(form);
    if (!parsedBody.success) return {ok: false, error: "Invalid balance check"};
    const user = await requireUser();

    const check = await prisma.balanceCheck.findFirst({where: {id: parsedBody.data.id, account: {userId: user.id}}});
    if (!check) return {ok: false, error: "Balance check not found"};
    await prisma.balanceCheck.delete({where: {id: check.id}});
    return {ok: true, data: null};
}

// Only empty accounts can be deleted, so no transaction loses its account. Archive the rest.
export async function DeleteAccount(form: DeleteAccountSchemaType): Promise<ActionResult<null>> {
    const parsedBody = DeleteAccountSchema.safeParse(form);
    if (!parsedBody.success) {
        return {ok: false, error: "Invalid account"};
    }
    const user = await requireUser();
    const {id} = parsedBody.data;

    const account = await prisma.account.findFirst({where: {id, userId: user.id}});
    if (!account) return {ok: false, error: "Account not found"};
    const used = await prisma.transaction.count({where: {OR: [{accountId: id}, {toAccountId: id}]}});
    if (used > 0) return {ok: false, error: "This account has transactions. Archive it instead."};

    await prisma.account.delete({where: {id}});
    return {ok: true, data: null};
}
