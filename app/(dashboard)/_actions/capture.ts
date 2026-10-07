"use server";

import {redirect} from "next/navigation";
import z from "zod";
import {currentUser} from "@/lib/auth";
import prisma from "@/lib/prisma";
import {generateCaptureToken, hashCaptureToken} from "@/lib/capture";

async function requireUser() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }
    return user;
}

// Returns the key once; only its hash is stored
export async function CreateCaptureToken(name: string) {
    const parsedName = z.string().trim().min(1).max(60).parse(name);
    const user = await requireUser();
    const token = generateCaptureToken();
    await prisma.captureToken.create({
        data: {userId: user.id, name: parsedName, tokenHash: hashCaptureToken(token)},
    });
    return {token};
}

export async function RevokeCaptureToken(id: string) {
    const user = await requireUser();
    await prisma.captureToken.deleteMany({where: {id: z.string().min(1).parse(id), userId: user.id}});
}
