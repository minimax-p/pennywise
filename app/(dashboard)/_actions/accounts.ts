"use server";

import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import prisma from "@/lib/prisma";
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

async function requireUser() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }
    return user;
}

async function assertNameAvailable(userId: string, name: string, excludeId?: string) {
    const existing = await prisma.account.findFirst({
        where: {userId, name, ...(excludeId && {NOT: {id: excludeId}})},
    });
    if (existing) {
        throw new Error(`An account named "${name}" already exists`);
    }
}

export async function CreateAccount(form: CreateAccountSchemaType) {
    const parsedBody = CreateAccountSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await requireUser();
    const {name, type, institution, walletCardName, balance, balanceDate} = parsedBody.data;
    await assertNameAvailable(user.id, name);

    return prisma.account.create({
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
}

export async function EditAccount(form: EditAccountSchemaType) {
    const parsedBody = EditAccountSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await requireUser();
    const {id, ...data} = parsedBody.data;

    const account = await prisma.account.findFirst({where: {id, userId: user.id}});
    if (!account) {
        throw new Error("Account not found");
    }
    await assertNameAvailable(user.id, data.name, id);

    return prisma.account.update({where: {id}, data});
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
export async function DeleteAccount(form: DeleteAccountSchemaType) {
    const parsedBody = DeleteAccountSchema.safeParse(form);
    if (!parsedBody.success) {
        throw new Error(parsedBody.error.message);
    }
    const user = await requireUser();
    const {id} = parsedBody.data;

    const account = await prisma.account.findFirst({where: {id, userId: user.id}});
    if (!account) {
        throw new Error("Account not found");
    }
    const used = await prisma.transaction.count({where: {OR: [{accountId: id}, {toAccountId: id}]}});
    if (used > 0) {
        throw new Error("This account has transactions. Archive it instead.");
    }

    return prisma.account.delete({where: {id}});
}
