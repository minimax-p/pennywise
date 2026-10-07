import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import {OverviewQuerySchema} from "@/schema/overview";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    const {searchParams} = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const queryParams = OverviewQuerySchema.safeParse({from, to});
    if(!queryParams.success){
        return Response.json(queryParams.error.message, {
            status: 400,
        });
    }

    const stats = await getCategoriesStats(
        user.id, queryParams.data.from, queryParams.data.to
    );
    return Response.json(stats);
}

export type GetCategoriesStatsResponseType = Awaited<ReturnType<typeof getCategoriesStats>>

async function getCategoriesStats(userId: string, from: Date, to: Date) {
    const stats = await prisma.transaction.groupBy({
        by: ['type', 'categoryId'],
        where: {
            userId,
            date: {
                gte: from,
                lte: to,
            }
        },
        _sum: {
            amount: true,
        },
        orderBy: {
            _sum: {
                amount: 'desc',
            }
        }
    });

    // Fetch category details for all unique categoryIds
    const categoryIds = [...new Set(stats.map(stat => stat.categoryId))];
    const categories = await prisma.category.findMany({
        where: {
            id: {
                in: categoryIds
            }
        },
        select: {
            id: true,
            name: true,
            icon: true
        }
    });

    // Create a map for quick lookup
    const categoryMap = new Map(categories.map(cat => [cat.id, cat]));

    // Enhance stats with category details
    const enhancedStats = stats.map(stat => ({
        ...stat,
        category: categoryMap.get(stat.categoryId) || { name: 'Unknown', icon: 'question-mark' }
    }));
    return enhancedStats;
}