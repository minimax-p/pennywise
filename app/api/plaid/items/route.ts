import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";

export async function GET() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
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
