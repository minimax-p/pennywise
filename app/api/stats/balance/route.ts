import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import {OverviewQuerySchema} from "@/schema/overview";
import {getTotals} from "@/lib/reports";

// Spending and income for a period; refunds lower spending and transfers don't count
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

    const {spending, income} = await getTotals(user.id, queryParams.data.from, queryParams.data.to);
    return Response.json({expense: spending, income});
}

export type GetBalanceStatsResponseType = { expense: number, income: number };
