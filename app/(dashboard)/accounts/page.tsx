'use client';

import React from 'react';
import {useQuery} from "@tanstack/react-query";
import {Plus} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Card} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {AccountLine} from "@/app/(dashboard)/_components/HomeView";
import {AccountFormDialog} from "@/app/(dashboard)/_components/AccountsManager";
import {useCurrencyFormatter} from "@/app/(dashboard)/_components/TransactionSheet";
import type {HomeData} from "@/lib/home";

function AccountsPage() {
    const home = useQuery<HomeData>({
        queryKey: ['home'],
        queryFn: () => fetch('/api/home').then((res) => res.json()),
    });
    const formatter = useCurrencyFormatter();
    const data = home.data;

    return (
        <>
            <PageHeader title="Accounts" subtitle={data ? `Net worth ${formatter.format(data.totals.netWorth)}` : "Every account, checked against the bank"}
                        actions={<AccountFormDialog trigger={<Button><Plus/>Add</Button>}/>}/>
            <div className="container flex flex-col gap-4 py-3">
                <SkeletonWrapper isLoading={home.isLoading}>
                    <div className="flex flex-col gap-4">
                        {(data?.groups ?? []).map((group) => (
                            <Card key={group.id} className="flex flex-col p-3 md:p-4">
                                <div className="flex items-baseline justify-between px-2 pb-1">
                                    <h2 className="font-display text-xl font-semibold">{group.label}</h2>
                                    <span className="font-display font-semibold money">{formatter.format(group.total)}</span>
                                </div>
                                {group.accounts.map((account) => <AccountLine key={account.id} account={account} formatter={formatter}/>)}
                            </Card>
                        ))}
                        {data && data.groups.length === 0 && (
                            <Card className="p-6 text-center font-semibold text-muted-foreground">No accounts yet. Add one to get started.</Card>
                        )}
                    </div>
                </SkeletonWrapper>
            </div>
        </>
    );
}

export default AccountsPage;
