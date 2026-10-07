import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";

export async function GET() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    const tokens = await getCaptureTokens(user.id);
    return Response.json(tokens);
}

export type GetCaptureTokensResponseType = Awaited<ReturnType<typeof getCaptureTokens>>

// Never select tokenHash here
async function getCaptureTokens(userId: string) {
    return prisma.captureToken.findMany({
        where: {userId},
        select: {id: true, name: true, lastUsedAt: true, createdAt: true},
        orderBy: {createdAt: 'asc'},
    });
}
