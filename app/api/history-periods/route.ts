import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import {getHistoryYears} from "@/lib/reports";

export async function GET() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }
    return Response.json(await getHistoryYears(user.id));
}

export type GetHistoryPeriodsResponseType = Awaited<ReturnType<typeof getHistoryYears>>
