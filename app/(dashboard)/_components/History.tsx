"use client"
import React, {useMemo} from 'react';
import {UserSettings} from "@prisma/client";
import {Period, TimeFrame} from "@/lib/types";
import {GetFormatterForCurrency} from "@/lib/helpers";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import HistoryPeriodSelector from "@/app/(dashboard)/_components/HistoryPeriodSelector";
import {useQuery} from "@tanstack/react-query";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis} from 'recharts'
import { ChartConfig, ChartContainer } from "@/components/ui/chart"

const chartConfig = {
    desktop: {
        label: "Desktop",
        color: "#2563eb",
    },
    mobile: {
        label: "Mobile",
        color: "#60a5fa",
    },
} satisfies ChartConfig
const chartData = [
    { month: "January", desktop: 186, mobile: 80 },
    { month: "February", desktop: 305, mobile: 200 },
    { month: "March", desktop: 237, mobile: 120 },
    { month: "April", desktop: 73, mobile: 190 },
    { month: "May", desktop: 209, mobile: 130 },
    { month: "June", desktop: 214, mobile: 140 },
]


function History({userSettings}:{userSettings: UserSettings}) {
    const [timeframe, setTimeFrame] = React.useState<TimeFrame>('month');
    const [period, setPeriod] = React.useState<Period>({
        month: new Date().getMonth(),
        year: new Date().getFullYear()
    })

    const formatter = useMemo(()=>{
        return GetFormatterForCurrency(userSettings.currency)
    }, [userSettings.currency])

    const historyDataQuery = useQuery({
        queryKey: ['overview', 'history', timeframe, period],
        queryFn: ()=> fetch(`/api/history-data?timeframe=${timeframe}&year=${period.year}&month=${period.month}`).then(
            res=>res.json())
    })

    const dataAvailable = historyDataQuery.data && historyDataQuery.data.length > 0;

    return (
        <div className="container">
            <h2 className="mt-12 text-3xl font-bold">History</h2>
            <Card className="col-span-12 mt-2 w-full">
                <CardHeader className="gap-2">
                    <CardTitle className="grid grid-flow-row justify-between gap-2 md:grid-flow-col">
                        <HistoryPeriodSelector period={period} setPeriod={setPeriod} timeframe={timeframe}
                                               setTimeFrame={setTimeFrame}/>
                        <div className="flex h-10 gap-2">
                            <Badge variant='outline' className="rounded-full flex items-center gap-2 text-sm">
                                <div className="h-4 w-4 rounded-full bg-lime-500"></div>
                                Income
                            </Badge>
                            <Badge variant={'outline'} className="rounded-full cxflex items-center gap-2 text-sm">
                                <div className="h-4 w-4 rounded-full bg-amber-500"></div>
                                Expense
                            </Badge>
                        </div>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <SkeletonWrapper isLoading={historyDataQuery.isFetching}>
                        {dataAvailable ? (
                            <ChartContainer config={chartConfig} className="min-h-[300px] h-[300px] w-[700  px]">
                                <BarChart accessibilityLayer data={chartData}>
                                    <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
                                    <Bar dataKey="mobile" fill="var(--color-mobile)" radius={4} />
                                </BarChart>
                            </ChartContainer>
                        ) : (
                            <Card className="h-[300px] flex flex-col items-center justify-center bg-background">
                                No data available
                                <p className="text-sm text-muted-foreground">
                                    Try a different period or add new transactions
                                </p>
                            </Card>
                        )}
                    </SkeletonWrapper>
                </CardContent>
            </Card>
            <div className='h-[2rem]'></div>
        </div>
    );
}

export default History;