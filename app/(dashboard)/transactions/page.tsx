'use client';

import React, {Suspense, useMemo, useState} from 'react';
import {useSearchParams} from "next/navigation";
import {useQuery} from "@tanstack/react-query";
import {differenceInDays, endOfMonth, startOfMonth, startOfYear, subMonths} from "date-fns";
import {Search} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Card} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {useAccounts} from "@/app/(dashboard)/_components/AccountPicker";
import {DayGroupedList, ListRow} from "@/app/(dashboard)/_components/TransactionList";
import {useCurrencyFormatter} from "@/app/(dashboard)/_components/TransactionSheet";
import type {GetTransactionsHistoryResponseType} from "@/app/api/transactions/route";
import {DateToUTCDate, ToDayString} from "@/lib/helpers";
import {MAX_DATE_RANGE_DAYS} from "@/lib/constants";
import {cn} from "@/lib/utils";

type RangeId = "this-month" | "last-month" | "3-months" | "this-year" | "custom";
type TypeFilter = "all" | "spent" | "got" | "moved" | "to-sort";

const RANGES: { id: RangeId, label: string }[] = [
    {id: "this-month", label: "This month"},
    {id: "last-month", label: "Last month"},
    {id: "3-months", label: "3 months"},
    {id: "this-year", label: "This year"},
    {id: "custom", label: "Pick dates"},
];

const TYPES: { id: TypeFilter, label: string }[] = [
    {id: "all", label: "All"},
    {id: "spent", label: "Spent"},
    {id: "got", label: "Got"},
    {id: "moved", label: "Moved"},
    {id: "to-sort", label: "To sort"},
];

const ALL = "__all";

function rangeFor(id: RangeId, now = new Date()): { from: Date, to: Date } {
    switch (id) {
        case "last-month": {
            const last = subMonths(now, 1);
            return {from: startOfMonth(last), to: endOfMonth(last)};
        }
        case "3-months":
            return {from: startOfMonth(subMonths(now, 2)), to: now};
        case "this-year":
            return {from: startOfYear(now), to: now};
        default:
            return {from: startOfMonth(now), to: now};
    }
}

function parseDay(day: string) {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d);
}

function matchesType(row: ListRow, filter: TypeFilter) {
    switch (filter) {
        case "spent":
            return row.type === "expense";
        case "got":
            return row.type === "income";
        case "moved":
            return row.type === "transfer" || row.type === "adjustment";
        case "to-sort":
            return row.needsReview;
        default:
            return true;
    }
}

function TransactionsView() {
    const params = useSearchParams();
    const [range, setRange] = useState<RangeId>(params.get("from") ? "custom" : "this-month");
    const [customFrom, setCustomFrom] = useState(params.get("from") ?? ToDayString(startOfMonth(new Date())));
    const [customTo, setCustomTo] = useState(params.get("to") ?? ToDayString(new Date()));
    const [search, setSearch] = useState(params.get("q") ?? "");
    const [type, setType] = useState<TypeFilter>("all");
    const [accountId, setAccountId] = useState<string>(params.get("account") ?? ALL);
    const accounts = useAccounts().data ?? [];
    const formatter = useCurrencyFormatter();

    const {from, to, tooLong} = useMemo(() => {
        if (range !== "custom") return {...rangeFor(range), tooLong: false};
        const f = parseDay(customFrom), t = parseDay(customTo);
        return {from: f, to: t, tooLong: differenceInDays(t, f) > MAX_DATE_RANGE_DAYS || t < f};
    }, [range, customFrom, customTo]);

    const query = useQuery<GetTransactionsHistoryResponseType>({
        queryKey: ['transactions', 'history', from, to],
        queryFn: () => fetch(`/api/transactions?from=${DateToUTCDate(from).toISOString()}&to=${DateToUTCDate(to).toISOString()}`).then((res) => res.json()),
        enabled: !tooLong,
    });

    const rows = useMemo(() => {
        const term = search.trim().toLowerCase();
        return (Array.isArray(query.data) ? query.data : []).filter((t) =>
            matchesType(t, type)
            && (accountId === ALL || t.accountId === accountId || t.toAccountId === accountId)
            && (!term
                || t.description.toLowerCase().includes(term)
                || t.category.name.toLowerCase().includes(term)
                || (t.note ?? "").toLowerCase().includes(term)
                || t.amount.toFixed(2).includes(term.replace(/^[$-]/, "")))
        );
    }, [query.data, search, type, accountId]);

    // Spending and money in among what's shown; refunds lower spending
    const totals = useMemo(() => rows.reduce((sum, t) => {
        if (t.type === "expense" && t.category.type === "expense") sum.spent += t.amount;
        if (t.type === "income" && t.category.type === "expense") sum.spent -= t.amount;
        if (t.type === "income" && t.category.type === "income") sum.income += t.amount;
        return sum;
    }, {spent: 0, income: 0}), [rows]);

    const chip = (active: boolean) => cn(
        "shrink-0 rounded-full border-2 px-3.5 py-1.5 text-sm font-bold transition-colors",
        active ? "border-primary bg-primary-soft" : "border-border bg-card text-muted-foreground hover:text-foreground",
    );

    return (
        <>
            <PageHeader title="Transactions"
                        subtitle={query.data ? `${rows.length} shown · spent ${formatter.format(totals.spent)} · came in ${formatter.format(totals.income)}` : "Every account, in one list"}/>
            <div className="container flex flex-col gap-3 py-3">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10"
                           placeholder="Search places, notes, categories or amounts" aria-label="Search"/>
                </div>
                <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
                    {RANGES.map((r) => (
                        <button key={r.id} type="button" className={chip(range === r.id)} onClick={() => setRange(r.id)}>{r.label}</button>
                    ))}
                </div>
                {range === "custom" && (
                    <div className="grid grid-cols-2 gap-3">
                        <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From"/>
                        <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="To"/>
                        {tooLong && (
                            <p className="col-span-2 text-sm font-semibold text-destructive">
                                Pick a start before the end, at most {MAX_DATE_RANGE_DAYS} days apart.
                            </p>
                        )}
                    </div>
                )}
                <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4">
                    {TYPES.map((t) => (
                        <button key={t.id} type="button" className={chip(type === t.id)} onClick={() => setType(t.id)}>{t.label}</button>
                    ))}
                    {accounts.length > 0 && (
                        <Select value={accountId} onValueChange={setAccountId}>
                            <SelectTrigger className="h-9 w-auto min-w-[150px] shrink-0 rounded-full" aria-label="Account">
                                <SelectValue/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL}>All accounts</SelectItem>
                                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                </div>
                <SkeletonWrapper isLoading={query.isLoading}>
                    <Card className="p-2 md:p-3">
                        <DayGroupedList rows={rows} empty={
                            <p className="p-8 text-center font-semibold text-muted-foreground">
                                {query.data?.length ? "Nothing matches. Try another search or filter." : "No transactions in these dates."}
                            </p>
                        }/>
                    </Card>
                </SkeletonWrapper>
            </div>
        </>
    );
}

function TransactionsPage() {
    return (
        <Suspense>
            <TransactionsView/>
        </Suspense>
    );
}

export default TransactionsPage;
