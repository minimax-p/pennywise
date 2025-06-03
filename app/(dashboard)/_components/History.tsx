"use client"
import React, {useCallback, useMemo} from 'react';
import {UserSettings} from "@prisma/client";
import {Period, TimeFrame} from "@/lib/types";
import {GetFormatterForCurrency} from "@/lib/helpers";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import HistoryPeriodSelector from "@/app/(dashboard)/_components/HistoryPeriodSelector";
import {useQuery} from "@tanstack/react-query";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts'
import { ChartConfig, ChartContainer } from "@/components/ui/chart"
import {cn} from "@/lib/utils";
import CountUp from "react-countup";

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
                <CardHeader className="gap-2 font-mono">
                    <CardTitle className="grid grid-flow-row justify-between gap-2 md:grid-flow-col">
                        <HistoryPeriodSelector period={period} setPeriod={setPeriod} timeframe={timeframe}
                                               setTimeFrame={setTimeFrame}/>
                        <div className="flex h-10 gap-2">
                            <Badge variant='outline' className="rounded-full flex items-center gap-2 text-sm">
                                <div className="h-4 w-4 rounded-full bg-sky-500"></div>
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
                            <ResponsiveContainer width={'100%'} height={300}>
                                <BarChart height={300} className={"max-w-100"} data={historyDataQuery.data} barCategoryGap={5}>
                                    <defs>
                                        <linearGradient id="incomeBar" x1="0" y="0" x2="0" y2="1">
                                            <stop offset={'0'} stopColor="#0ea5e9" stopOpacity={'1'}></stop>
                                            <stop offset={'1'} stopColor="#38bdf8" stopOpacity={'0'}></stop>
                                        </linearGradient>
                                        <linearGradient id="expenseBar" x1="0" y="0" x2="0" y2="1">
                                            <stop offset={'0'} stopColor="#F59E0C" stopOpacity={'1'}></stop>
                                            <stop offset={'1'} stopColor="#F59E0C" stopOpacity={'0'}></stop>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="5 5" strokeOpacity={'0.2'} vertical={false}/>
                                    <XAxis stroke={'#888888'} fontSize={12} tickLine={false} axisLine={false} padding={{left: 5, right: 5}}
                                           dataKey={data=>{
                                               const {year, month, day} = data;
                                               const date = new Date(year, month, day || 1);
                                               if (timeframe==='year'){
                                                   return date.toLocaleString('default', {month: "long"})
                                               }

                                               return date.toLocaleString('default', {day: "2-digit"})

                                           }}/>
                                    <YAxis stroke={'#888888'} fontSize={12} tickLine={false} axisLine={false}/>
                                    <Bar dataKey={'income'} label="Income" fill='url(#incomeBar)' radius={4} className='cursor-pointer'></Bar>
                                    <Bar dataKey={'expense'} label="Expense" fill='url(#expenseBar)' radius={4} className='cursor-pointer'></Bar>
                                    <Tooltip cursor={{opacity: 0.1}} content={props=>(
                                        <CustomToolTip formatter={formatter} {...props}/>
                                    )}/>
                                </BarChart>
                            </ResponsiveContainer>
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

function CustomToolTip ({active, payload, formatter}:any) {
    if (!active || !payload || payload.length === 0) return null;

    const data = payload[0].payload;
    const {expense, income} = data;

    return (
        <div className='min-w-[100px] rounded border bg-background p-4'>
            <TooltipRow formatter={formatter} label='Income' value={income} bgColor='bg-sky-500' textColor='text-sky-500' />
            <TooltipRow formatter={formatter} label='Expense' value={expense} bgColor='bg-amber-500' textColor='text-amber-500' />
            <TooltipRow formatter={formatter} label='Balance' value={income-expense} bgColor='bg-stone-500' textColor='text-foreground' />
        </div>
    )
}

function TooltipRow({label, value, bgColor, textColor, formatter}:{
    label: string, textColor: string, bgColor: string, value: number, formatter: Intl.NumberFormat
}){
    const formattingFn = useCallback((value: number) => {
        return formatter.format(value)
    }, [formatter])

    return (
        <div className='flex items-center gap-2'>
            <div className={cn('h-4 w-4 rounded-full', bgColor)}/>
            <span className='flex items-center gap-2'>
                <p className='text-sm text-muted-foreground'>{label}</p>
                <div className={cn('text-sm font-bold', textColor)}>
                    <CountUp duration={0.5} preserveValue end={value} decimals={0}
                             formattingFn={formattingFn} className='text-sm'/>
                </div>
            </span>
        </div>
    )
}