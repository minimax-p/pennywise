import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";

export async function GET() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    // The Plaid section is only shown when Plaid credentials are configured
    const enabled = Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
    const items = enabled ? await getPlaidItems(user.id) : [];
    return Response.json({enabled, items});
}

export type GetPlaidItemsResponseType = {
    enabled: boolean,
    items: Awaited<ReturnType<typeof getPlaidItems>>,
}

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
