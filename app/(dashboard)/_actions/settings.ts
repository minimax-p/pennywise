"use server";

import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import prisma from "@/lib/prisma";
import {UpdateSelfNamesSchema} from "@/schema/userSettings";

type ActionResult<T> = { ok: true, data: T } | { ok: false, error: string };

// Zelle payments to or from these names are imported as moves between your own accounts
export async function UpdateSelfNames(selfNames: string): Promise<ActionResult<string | null>> {
    const parsed = UpdateSelfNamesSchema.safeParse({selfNames});
    if (!parsed.success) return {ok: false, error: "Keep it under 191 characters"};
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }
    const settings = await prisma.userSettings.upsert({
        where: {userId: user.id},
        create: {userId: user.id, currency: "USD", selfNames: parsed.data.selfNames},
        update: {selfNames: parsed.data.selfNames},
    });
    return {ok: true, data: settings.selfNames};
}
