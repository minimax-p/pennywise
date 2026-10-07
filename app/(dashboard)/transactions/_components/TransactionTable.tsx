'use client';

import React, {useMemo, useState} from 'react';
import {useQuery} from "@tanstack/react-query";
import {Landmark, Pencil, Search, Trash2} from "lucide-react";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {DateToUTCDate} from "@/lib/helpers";
import {cn} from "@/lib/utils";
import type {GetTransactionsHistoryResponseType} from "@/app/api/transactions/route";
import EditTransactionDialog from "@/app/(dashboard)/transactions/_components/EditTransactionDialog";
import DeleteTransactionDialog from "@/app/(dashboard)/transactions/_components/DeleteTransactionDialog";
import {useAccounts} from "@/app/(dashboard)/_components/AccountPicker";

interface Props {
    from: Date;
    to: Date;
}

type TypeFilter = 'all' | 'income' | 'expense' | 'transfer';

const ALL = '__all';
const NO_ACCOUNT = '__none';

const SOURCE_LABELS: Record<string, string> = {
    manual: 'Manual',
    import: 'Imported',
    apple_pay: 'Apple Pay',
};

// Dates are stored with the local calendar day in their UTC fields
const dateFormatter = new Intl.DateTimeFormat('default', {timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric'});

function TransactionTable({from, to}: Props) {
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [accountFilter, setAccountFilter] = useState<string>(ALL);
    const accountsQuery = useAccounts();
    const accounts = Array.isArray(accountsQuery.data) ? accountsQuery.data : [];

    const historyQuery = useQuery<GetTransactionsHistoryResponseType>({
        queryKey: ['transactions', 'history', from, to],
        queryFn: () => fetch(`/api/transactions?from=${DateToUTCDate(from)}&to=${DateToUTCDate(to)}`).then((res) => res.json()),
    });

    const rows = useMemo(() => {
        const term = search.trim().toLowerCase();
        return (historyQuery.data ?? []).filter((t) =>
            (typeFilter === 'all' || t.type === typeFilter) &&
            (accountFilter === ALL
                || (accountFilter === NO_ACCOUNT ? !t.accountId : t.accountId === accountFilter || t.toAccountId === accountFilter)) &&
            (!term || t.description.toLowerCase().includes(term) || t.category.name.toLowerCase().includes(term))
        );
    }, [historyQuery.data, search, typeFilter, accountFilter]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/>
                    <Input placeholder="Search description or category" value={search}
                           onChange={(e) => setSearch(e.target.value)} className="pl-8"/>
                </div>
                <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}>
                    <SelectTrigger className="w-[140px]">
                        <SelectValue/>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        <SelectItem value="income">Income</SelectItem>
                        <SelectItem value="expense">Expense</SelectItem>
                        <SelectItem value="transfer">Transfer</SelectItem>
                    </SelectContent>
                </Select>
                {accounts.length > 0 && (
                    <Select value={accountFilter} onValueChange={setAccountFilter}>
                        <SelectTrigger className="w-[180px]" aria-label="Account">
                            <SelectValue/>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All accounts</SelectItem>
                            {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                            <SelectItem value={NO_ACCOUNT}>No account</SelectItem>
                        </SelectContent>
                    </Select>
                )}
            </div>
            <SkeletonWrapper isLoading={historyQuery.isLoading}>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Category</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead>Account</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                <TableHead>Source</TableHead>
                                <TableHead className="w-[100px]"><span className="sr-only">Actions</span></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                        {historyQuery.data?.length ? 'No transactions match your filters' : 'No transactions in this period'}
                                    </TableCell>
                                </TableRow>
                            )}
                            {rows.map((transaction) => (
                                <TableRow key={transaction.id}>
                                    <TableCell className="whitespace-nowrap">
                                        {dateFormatter.format(new Date(transaction.date))}
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap">
                                        <span className="mr-2" role="img">{transaction.category.icon}</span>
                                        {transaction.category.name}
                                    </TableCell>
                                    <TableCell className="max-w-[240px] truncate">{transaction.description}</TableCell>
                                    <TableCell className="whitespace-nowrap text-sm">
                                        {transaction.type === 'transfer'
                                            ? `${transaction.accountName ?? '?'} → ${transaction.toAccountName ?? '?'}`
                                            : transaction.accountName ?? <span className="text-muted-foreground">-</span>}
                                    </TableCell>
                                    <TableCell>
                                        <span className={cn(
                                            "rounded-lg px-2 py-1 text-xs capitalize",
                                            transaction.type === 'income' && "bg-sky-400/10 text-sky-500",
                                            transaction.type === 'expense' && "bg-amber-400/10 text-amber-500",
                                            transaction.type === 'transfer' && "bg-violet-400/10 text-violet-400",
                                        )}>
                                            {transaction.type}
                                        </span>
                                    </TableCell>
                                    <TableCell className={cn(
                                        "whitespace-nowrap text-right font-mono",
                                        transaction.type === 'income' && "text-sky-500",
                                        transaction.type === 'expense' && "text-amber-500",
                                        transaction.type === 'transfer' && "text-muted-foreground",
                                    )}>
                                        {transaction.type === 'expense' ? '-' : ''}{transaction.formattedAmount}
                                    </TableCell>
                                    <TableCell>
                                        {transaction.source ? (
                                            <Badge variant="outline" className="gap-1 whitespace-nowrap">
                                                <Landmark className="h-3 w-3"/>
                                                {transaction.source}
                                            </Badge>
                                        ) : (
                                            <span className="whitespace-nowrap text-sm text-muted-foreground">
                                                {SOURCE_LABELS[transaction.entrySource] ?? 'Manual'}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex justify-end gap-1">
                                            <EditTransactionDialog
                                                transaction={transaction}
                                                trigger={
                                                    <Button variant="ghost" size="icon" aria-label="Edit transaction">
                                                        <Pencil className="h-4 w-4"/>
                                                    </Button>
                                                }
                                            />
                                            <DeleteTransactionDialog
                                                transaction={transaction}
                                                trigger={
                                                    <Button variant="ghost" size="icon" aria-label="Delete transaction"
                                                            className="hover:text-destructive">
                                                        <Trash2 className="h-4 w-4"/>
                                                    </Button>
                                                }
                                            />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </SkeletonWrapper>
        </div>
    );
}

export default TransactionTable;
