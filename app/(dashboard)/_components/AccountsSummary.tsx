'use client';

import React from 'react';
import Link from "next/link";
import {UserSettings} from "@prisma/client";
import {Wallet} from "lucide-react";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Card} from "@/components/ui/card";
import {ACCOUNT_TYPE_ICONS, useAccounts} from "@/app/(dashboard)/_components/AccountPicker";
import {formatBalance} from "@/app/(dashboard)/_components/AccountsManager";
import {GetFormatterForCurrency} from "@/lib/helpers";
import {AccountType} from "@/lib/types";
import {cn} from "@/lib/utils";

function AccountsSummary({userSettings}: { userSettings: UserSettings }) {
    const accountsQuery = useAccounts();
    const formatter = GetFormatterForCurrency(userSettings.currency);
    const accounts = (Array.isArray(accountsQuery.data) ? accountsQuery.data : []).filter((a) => !a.archived);
    const netWorth = accounts.reduce((sum, a) => sum + a.balance, 0);

    if (!accountsQuery.isLoading && accounts.length === 0) {
        return (
            <div className="container pt-6">
                <Card className="p-4 text-sm text-muted-foreground">
                    Track balances per account and card: <Link href="/manage" className="underline">add your accounts</Link>.
                </Card>
            </div>
        );
    }

    return (
        <div className="container pt-6">
            <h2 className="mb-3 text-3xl font-bold">Accounts</h2>
            <SkeletonWrapper isLoading={accountsQuery.isLoading}>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                    {accounts.map((account) => {
                        const Icon = ACCOUNT_TYPE_ICONS[account.type as AccountType] ?? Wallet;
                        return (
                            <Card key={account.id} className="flex flex-col gap-1 p-4">
                                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Icon className="h-4 w-4"/>{account.name}
                                </span>
                                <span className={cn(
                                    "font-mono text-lg",
                                    account.type === 'credit' && account.balance < 0 && "text-amber-500"
                                )}>
                                    {formatBalance(account, formatter)}
                                </span>
                            </Card>
                        );
                    })}
                    <Card className="flex flex-col gap-1 p-4">
                        <span className="text-sm text-muted-foreground">Net worth</span>
                        <span className="font-mono text-lg">{formatter.format(netWorth)}</span>
                    </Card>
                </div>
            </SkeletonWrapper>
        </div>
    );
}

export default AccountsSummary;
