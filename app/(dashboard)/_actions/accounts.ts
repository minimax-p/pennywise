"use server";

import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import prisma from "@/lib/prisma";
import {Account} from "@prisma/client";
import {
    CreateAccountSchema,
    CreateAccountSchemaType,
    DeleteAccountSchema,
    DeleteAccountSchemaType,
    EditAccountSchema,
    EditAccountSchemaType,
    SetAccountBalanceSchema,
    SetAccountBalanceSchemaType
} from "@/schema/account";

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
    const {name, type, institution, walletCardName, balance, balanceDate} = parsedBody.data;
    const taken = await nameTaken(user.id, name);
    if (taken) return {ok: false, error: taken};

    const account = await prisma.account.create({
        data: {
            userId: user.id,
            name,
            type,
            institution,
            walletCardName,
            knownBalance: balance,
            knownBalanceDate: balanceDate,
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

    return {ok: true, data: await prisma.account.update({where: {id}, data})};
}

// Records the balance shown by the bank. Transactions dated after it are added on top.
export async function SetAccountBalance(form: SetAccountBalanceSchemaType) {
    const parsedBody = SetAccountBalanceSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await requireUser();
    const {id, balance, balanceDate} = parsedBody.data;

    const account = await prisma.account.findFirst({where: {id, userId: user.id}});
    if (!account) {
        throw new Error("Account not found");
    }

    return prisma.account.update({
        where: {id},
        data: {knownBalance: balance, knownBalanceDate: balanceDate},
    });
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
