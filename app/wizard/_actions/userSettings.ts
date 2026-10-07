"use server";

import {UpdateUserCurrencySchema} from "@/schema/userSettings";
import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";

export async function UpdateUserCurrency (currency:string){
    const parsedBody = UpdateUserCurrencySchema.safeParse({
        currency,
    });
    if (!parsedBody.success){
        throw parsedBody.error;
    }

    const user = await currentUser();
    if (!user){
        redirect('/login')
    }

    const userSettings = await prisma.userSettings.update({
        where:{
            userId: user.id
        },
        data:{
            currency,
        }
    })

    return userSettings;
}