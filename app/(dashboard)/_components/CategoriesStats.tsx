"use client";

import React, {useMemo} from 'react';
import {UserSettings} from "@prisma/client";
import {useQuery} from "@tanstack/react-query";
import {DateToUTCDate, GetFormatterForCurrency} from "@/lib/helpers";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {TransactionType} from "@/lib/types";
import {GetCategoriesStatsResponseType} from "@/app/api/stats/categories/route";
import {Card, CardHeader, CardTitle} from "@/components/ui/card";
import {ScrollArea} from "@/components/ui/scroll-area";
import {Progress} from "@/components/ui/progress";

interface Props {
    userSettings: UserSettings;
    from: Date;
    to: Date;
}

function CategoriesStats({userSettings, from, to}: Props) {

    const statsQuery = useQuery<GetCategoriesStatsResponseType>({
        queryKey: ['overview', 'stats','categories', from, to],
        queryFn: () => fetch(`/api/stats/categories?from=${DateToUTCDate(from)}&to=${DateToUTCDate(to)}`).then((res) => res.json())
    })
    const formatter = useMemo(()=>{
        return GetFormatterForCurrency(userSettings.currency)
    }, [userSettings.currency])

    return (
        <div className="flex w-full flex-wrap gap-2 md:flex-nowrap">
            <SkeletonWrapper isLoading={statsQuery.isFetching}>
                <CategoriesCard formatter={formatter} type="income" data={statsQuery.data || []}></CategoriesCard>
            </SkeletonWrapper>
            <SkeletonWrapper isLoading={statsQuery.isFetching}>
                <CategoriesCard formatter={formatter} type="expense" data={statsQuery.data || []}></CategoriesCard>
            </SkeletonWrapper>
        </div>
    );
}

export default CategoriesStats;

function CategoriesCard({type, formatter, data}:{type: TransactionType, formatter: Intl.NumberFormat, data: GetCategoriesStatsResponseType}) {

    const filteredData = data.filter(el => el.type === type)
    // console.log(filteredData)
    const total = filteredData.reduce((acc, el)=> acc+(el._sum?.amount || 0), 0)

    return (
        <Card className="h-80 w-full col-span-6">
            <CardHeader>
                <CardTitle className="text-lg grid grid-flow-row justify-between gap-2 text-muted-foreground md:grid-flow-col">
                    {type === "income" ? "Income" : "Expense"} by category
                </CardTitle>
            </CardHeader>
            <div className="flex items-center justify-between gap-2">
                {filteredData.length === 0 && (
                    <div className="flex h-60 w-full flex-col items-center justify-center px-4">
                        No data for the selected period
                        <p className="text-sm text-muted-foreground">
                            Try a different period or add new {type === "income" ? "incomes" : "expenses"}
                        </p>
                    </div>
                )}
                {filteredData.length > 0 && (
                    <ScrollArea className="h-60 w-full px-4">
                        <div className="flex w-full flex-col gap-4 p-4">
                            {
                                filteredData.map(item=>{
                                    const amount = item._sum.amount || 0;
                                    const percentage = (amount*100) / (total || amount)

                                    return (
                                        <div key={item.categoryId} className="flex flex-col gap-2 font-mono">
                                            <div className="flex items-center justify-between">
                                                <span className="flex items-center">
                                                    {item.category.icon} {item.category.name}
                                                    <span className="ml-2 text-xs">
                                                        ({percentage.toFixed(2)}%)
                                                    </span>
                                                </span>
                                                <span className="txt-sm">
                                                    {formatter.format(amount)}
                                                </span>
                                            </div>
                                            {
                                                type === 'income' && (
                                                    <Progress value={percentage} color={'bg-sky-500'} max={100}/>
                                                )
                                            }
                                            {
                                                type === 'expense' && (
                                                    <Progress value={percentage} color={'bg-amber-500'} max={100}/>
                                                )
                                            }

                                        </div>
                                    )
                                })
                            }
                        </div>
                    </ScrollArea>
                )}
            </div>
        </Card>
    )
}