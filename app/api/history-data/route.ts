import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import z from "zod";
import {getHistory} from "@/lib/reports";

const getHistoryDataSchema = z.object({
    timeframe: z.enum(['month', 'year']),
    month: z.coerce.number().min(0).max(11).default(0),
    year: z.coerce.number().min(2000).max(3000)
})

export async function GET(request: Request) {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }

    const {searchParams} = new URL(request.url);
    const queryParams = getHistoryDataSchema.safeParse({
        timeframe: searchParams.get('timeframe'),
        month: searchParams.get('month'),
        year: searchParams.get('year'),
    });
    if (!queryParams.success) {
        return Response.json(queryParams.error.message, {status: 400});
    }

    const {timeframe, year, month} = queryParams.data;
    return Response.json(await getHistory(user.id, timeframe, year, month));
}

export type GetHistoryDataResponseType = Awaited<ReturnType<typeof getHistory>>
