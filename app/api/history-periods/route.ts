import {currentUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import prisma from "@/lib/prisma";

export async function GET(request: Request){
    const user = await currentUser();
    if (!user){
        redirect('/login');
    }

    const periods = await getHistoryPeriods(user.id);
    return Response.json(periods);
}

export type GetHistoryPeriodsResponseType = Awaited<ReturnType<typeof getHistoryPeriods>>
async function getHistoryPeriods(userId: string){
    const result = await prisma.monthHistory.findMany({
        where:{
            userId,
        },
        select:{
            year: true
        },
        distinct: ['year'],
        orderBy:[
            {year: 'asc'},
        ]
    })

    const years = result.map(el=>el.year);
    if (years.length === 0){
        return [new Date().getFullYear()];
    }

    return years;
}