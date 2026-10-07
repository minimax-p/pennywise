import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import {OverviewQuerySchema} from "@/schema/overview";
import {getCategoryTotals} from "@/lib/reports";

// Net spending and income per category for a period, largest first
export async function GET(request: Request) {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    const {searchParams} = new URL(request.url);
    const queryParams = OverviewQuerySchema.safeParse({from: searchParams.get('from'), to: searchParams.get('to')});
    if (!queryParams.success) {
        return Response.json(queryParams.error.message, {status: 400});
    }

    return Response.json(await getCategoryTotals(user.id, queryParams.data.from, queryParams.data.to));
}

export type GetCategoriesStatsResponseType = Awaited<ReturnType<typeof getCategoryTotals>>
