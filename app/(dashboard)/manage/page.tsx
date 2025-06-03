'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyComboBox } from "@/components/CurrencyComboBox";
import { TransactionType } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import { PlusSquare, Trash2Icon, TrendingDown, TrendingUp } from "lucide-react";
import CreateCategoryDialog from "@/app/(dashboard)/_components/CreateCategoryDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Category } from "@prisma/client";
import DeleteCategoryDialog from "@/app/(dashboard)/_components/DeleteCategoryDialog";
import EditCategoryDialog from "@/app/(dashboard)/_components/EditCategoryDialog";


function Page() {
    return (
        <>
            <div className='border-b bg-card'>
                <div className='container flex flex-wrap items-center justify-between gap-6 py-8'>
                    <div>
                        <p className='text-3xl font-bold'>Manage</p>
                        <p className='text-muted-foreground'>Manage your account settings</p>
                    </div>
                </div>
            </div>
            <div className='container flex flex-col gap-4 p-4'>
                {/*TODO: Link account to Plaid!!!!!*/}
                <Card>
                    <CardHeader>
                        <CardTitle>Link Your Bank Accounts</CardTitle>
                        <CardDescription>Connect your accounts securely with Plaid</CardDescription>
                    </CardHeader>
                    <CardContent>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Currency</CardTitle>
                        <CardDescription>Set your default currency for transactions</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <CurrencyComboBox />
                    </CardContent>
                </Card>
                <CategoryList type='income' />
                <CategoryList type='expense' />
            </div>
        </>
    );
}

export default Page;

function CategoryList({type}:{type: TransactionType}) {
    const categoriesQuery = useQuery({
        queryKey: ['categories', type],
        queryFn: () => fetch(`/api/categories?type=${type}`).then(res => res.json())
    })

    const dataAvailable = categoriesQuery.data && categoriesQuery.data.length > 0

    return (
        <SkeletonWrapper isLoading={categoriesQuery.isLoading}>
            <Card>
                <CardHeader>
                    <CardTitle className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-4">
                            {type === 'income' ? (
                                <TrendingUp className="h-12 w-12 rounded-lg bg-sky-400/10 p-2 text-sky-500" />
                            ) : (
                                <TrendingDown className="h-12 w-12 rounded-lg bg-amber-400/10 p-2 text-amber-500" />
                            )}
                            <div>
                                <h2 className="text-xl font-semibold">
                                    {type === 'income' ? 'Income Categories' : 'Expense Categories'}
                                </h2>
                                <p className="text-sm text-muted-foreground">Sorted by name</p>
                            </div>
                        </div>
                        <CreateCategoryDialog
                            type={type}
                            successCallBack={() => categoriesQuery.refetch()}
                            trigger={(
                                <Button
                                    className={cn(
                                        "mt-2 w-full sm:mt-0 sm:w-auto",
                                        type === 'income'
                                            ? 'bg-sky-200 hover:bg-sky-600'
                                            : 'bg-amber-300 hover:bg-amber-700',
                                        'gap-2 text-sm text-black hover:text-white font-mono'
                                    )}
                                >
                                    <PlusSquare className="h-4 w-4" />
                                    <span className="hidden sm:inline">Create category</span>
                                    <span className="sm:hidden">New</span>
                                </Button>
                            )}
                        />
                    </CardTitle>
                </CardHeader>
                <Separator />
                {
                    !dataAvailable && (
                        <div className='flex h-40 w-full flex-col items-center justify-center'>
                            <p>
                                No <span className={cn('m-1', type === 'income' ? 'text-sky-500' : 'text-amber-500')}>{type}</span> categories yet
                            </p>
                            <p className='text-sm text-muted-foreground'>Create one to get started</p>
                        </div>
                    )
                }
                {
                    dataAvailable && (
                        <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 p-2'>
                            {categoriesQuery.data.map((category: Category) => (
                                <CategoryCard category={category} key={category.id} />
                            ))}
                        </div>
                    )
                }
            </Card>
        </SkeletonWrapper>
    )
}

function CategoryCard({category}:{category: Category}) {
    return (
        <div className='flex-border-separate flex-col justify-between rounded-md border shadow-md shadow-black/[0.1] dark:shadow-white/[0.1]'>
            <div className='flex flex-col items-center gap-2 p-4'>
                <span className='text-3xl' role='img'>{category.icon}</span>
                <span className='text-center'>{category.name}</span>
                {!category.isUniversal && (
                    <div className="flex w-full gap-2">
                        <EditCategoryDialog
                            category={category}
                            trigger={
                                <Button className='flex-1 items-center gap-2 text-muted-foreground hover:bg-blue-400 hover:text-white' variant={'secondary'}>
                                    Edit
                                </Button>
                            }
                        />
                        <DeleteCategoryDialog
                            category={category}
                            trigger={
                                <Button className='flex-1 items-center gap-2 text-muted-foreground hover:bg-red-400 hover:text-white' variant={'secondary'}>
                                    <Trash2Icon className='h-4 w-4' />
                                    Remove
                                </Button>
                            }
                        />
                    </div>
                )}
                {category.isUniversal && (
                    <div className="w-full text-center text-sm text-muted-foreground">
                        Universal Category
                    </div>
                )}
            </div>
        </div>
    )
}