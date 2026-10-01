import {currentUser} from "@clerk/nextjs/server";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";

export async function GET() {
    const user = await currentUser();
    if (!user) {
        redirect('/sign-in');
    }

    const items = await getPlaidItems(user.id);
    return Response.json(items);
}

export type GetPlaidItemsResponseType = Awaited<ReturnType<typeof getPlaidItems>>

// Never select accessToken here, this goes to the browser
async function getPlaidItems(userId: string) {
    return prisma.plaidItem.findMany({
        where: {userId},
        select: {
            id: true,
            institutionName: true,
            error: true,
            lastSyncedAt: true,
            createdAt: true,
            _count: {select: {transactions: true}},
        },
        orderBy: {createdAt: 'asc'},
    });
}
