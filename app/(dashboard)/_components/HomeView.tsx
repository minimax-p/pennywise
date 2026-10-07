'use client';

import React from 'react';
import Link from "next/link";
import {useQuery} from "@tanstack/react-query";
import {AlertTriangle, ChevronRight, Inbox, Scale} from "lucide-react";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import PennyMark from "@/components/PennyMark";
import {Card} from "@/components/ui/card";
import {buttonVariants} from "@/components/ui/button";
import {accountIcon} from "@/app/(dashboard)/_components/AccountPicker";
import {useCurrencyFormatter} from "@/app/(dashboard)/_components/TransactionSheet";
import {CompactList} from "@/app/(dashboard)/_components/TransactionList";
import type {HomeData} from "@/lib/home";
import {dayFormatter, formatBalance} from "@/lib/money";
import {cn} from "@/lib/utils";

const monthFormatter = new Intl.DateTimeFormat(undefined, {timeZone: "UTC", month: "long"});

function useHome() {
    return useQuery<HomeData>({
        queryKey: ['home'],
        queryFn: () => fetch('/api/home').then((res) => res.json()),
    });
}

function HomeView({firstName}: { firstName: string | null }) {
    const home = useHome();
    const formatter = useCurrencyFormatter();
    const data = home.data;

    if (data && !data.hasAccounts) {
        return (
            <div className="container py-6">
                <Card className="flex flex-col items-center gap-4 p-8 text-center">
                    <PennyMark className="h-20 w-20"/>
                    <h2 className="font-display text-2xl font-bold">Let&apos;s add your accounts</h2>
                    <p className="max-w-md text-muted-foreground">
                        Add your checking, savings, CDs, cards and cash, each with what the bank shows today.
                        Then Home shows the money you really have.
                    </p>
                    <Link href="/manage" className={buttonVariants({size: "lg"})}>Add accounts</Link>
                </Card>
            </div>
        );
    }

    return (
        <div className="container flex flex-col gap-5 py-4 md:py-8">
            <p className="font-bold text-muted-foreground">
                Hi{firstName ? ` ${firstName}` : ""} 👋
            </p>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                <div className="flex flex-col gap-5">
                    <SkeletonWrapper isLoading={home.isLoading}>
                        <SpendingMoney data={data} formatter={formatter}/>
                    </SkeletonWrapper>
                    <div className="grid grid-cols-2 gap-3">
                        <SkeletonWrapper isLoading={home.isLoading}>
                            <Tile label="Savings & CDs" value={formatter.format(data?.totals.savings ?? 0)} emoji="🐷"/>
                        </SkeletonWrapper>
                        <SkeletonWrapper isLoading={home.isLoading}>
                            <Tile label="Net worth" value={formatter.format(data?.totals.netWorth ?? 0)} emoji="🌱"/>
                        </SkeletonWrapper>
                    </div>
                    {data && <Attention data={data} formatter={formatter}/>}
                    <SkeletonWrapper isLoading={home.isLoading}>
                        {data ? <ThisMonth data={data} formatter={formatter}/> : <div className="h-64"/>}
                    </SkeletonWrapper>
                    {data && data.topCategories.length > 0 && <TopCategories data={data} formatter={formatter}/>}
                </div>
                <div className="flex flex-col gap-5">
                    <SkeletonWrapper isLoading={home.isLoading}>
                        {data ? <Accounts data={data} formatter={formatter}/> : <div className="h-64"/>}
                    </SkeletonWrapper>
                    {data && data.recent.length > 0 && (
                        <Card className="p-3 md:p-4">
                            <div className="flex items-center justify-between px-2 pb-1">
                                <h2 className="font-display text-xl font-semibold">Recent</h2>
                                <Link href="/transactions" className="flex items-center text-sm font-bold text-primary">
                                    See all<ChevronRight className="h-4 w-4"/>
                                </Link>
                            </div>
                            <CompactList rows={data.recent}/>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}

function SpendingMoney({data, formatter}: { data?: HomeData, formatter: Intl.NumberFormat }) {
    const value = data?.totals.spendingMoney ?? 0;
    return (
        <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary-soft to-card p-5 md:p-6">
            <PennyMark className="absolute -right-5 -top-5 h-28 w-28 rotate-12 opacity-90"/>
            <p className="text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Spending money</p>
            <p className={cn("mt-1 font-display text-5xl font-bold tracking-tight money md:text-6xl", value < 0 && "text-destructive")}>
                {formatter.format(value)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Cash and checking, minus what your cards owe.</p>
            {data && data.spendingParts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {data.spendingParts.map((part, i) => {
                        const owed = part.balance < 0;
                        return (
                            <Link key={part.id} href={`/accounts/${part.id}`}
                                  className="rounded-full bg-card/80 px-2.5 py-1 text-xs font-bold shadow-sm">
                                {i > 0 && <span className="text-muted-foreground">{owed ? "− " : "+ "}</span>}
                                {i === 0 && owed && <span className="text-muted-foreground">− </span>}
                                {part.name} <span className="money">{formatter.format(Math.abs(part.balance))}</span>
                            </Link>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

function Tile({label, value, emoji}: { label: string, value: string, emoji: string }) {
    return (
        <Card className="flex flex-col gap-1 p-4">
            <span className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                <span role="img" aria-hidden>{emoji}</span>{label}
            </span>
            <span className="font-display text-2xl font-semibold money">{value}</span>
        </Card>
    );
}

// Things that need you: transactions to sort, balances that don't add up or haven't been checked
function Attention({data, formatter}: { data: HomeData, formatter: Intl.NumberFormat }) {
    const stale = data.staleAccounts[0];
    if (!data.toSort && data.mismatchedAccounts.length === 0 && !stale) return null;
    return (
        <div className="flex flex-col gap-2">
            {data.toSort > 0 && (
                <Link href="/review" className="flex items-center gap-3 rounded-3xl border-2 border-sun/50 bg-sun-soft p-3.5 font-bold">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-sun text-[hsl(36_85%_20%)]"><Inbox className="h-5 w-5"/></span>
                    <span className="flex-1">{data.toSort} {data.toSort === 1 ? "transaction" : "transactions"} to sort</span>
                    <span className="text-sun-ink">Sort ›</span>
                </Link>
            )}
            {data.mismatchedAccounts.slice(0, 2).map((a) => (
                <Link key={a.id} href={`/accounts/${a.id}`} className="flex items-center gap-3 rounded-3xl border-2 border-destructive/30 bg-destructive/10 p-3.5 text-sm font-bold">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-destructive text-destructive-foreground"><AlertTriangle className="h-5 w-5"/></span>
                    <span className="flex-1">
                        {a.name} is off by {formatter.format(Math.abs(a.mismatch.difference))} between {dayFormatter.format(new Date(a.mismatch.from))} and {dayFormatter.format(new Date(a.mismatch.to))}
                    </span>
                    <span>Look ›</span>
                </Link>
            ))}
            {stale && (
                <Link href={`/accounts/${stale.id}?check=1`} className="flex items-center gap-3 rounded-3xl border-2 bg-card p-3.5 text-sm font-bold">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-secondary"><Scale className="h-5 w-5"/></span>
                    <span className="flex-1">
                        {stale.daysSinceCheck === null
                            ? `${stale.name}'s balance hasn't been checked with the bank yet`
                            : `${stale.name} was last checked ${stale.daysSinceCheck} days ago`}
                    </span>
                    <span className="text-primary">Check ›</span>
                </Link>
            )}
        </div>
    );
}

function ThisMonth({data, formatter}: { data: HomeData, formatter: Intl.NumberFormat }) {
    const {month} = data;
    const difference = month.spent - month.lastMonthSoFar;
    const monthName = monthFormatter.format(new Date(month.start));
    return (
        <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-baseline justify-between">
                <h2 className="font-display text-xl font-semibold">{monthName} so far</h2>
                <Link href="/reports" className="text-sm font-bold text-primary">Reports ›</Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-spend-soft p-3">
                    <p className="text-xs font-extrabold uppercase tracking-wider text-spend-ink">Spent</p>
                    <p className="font-display text-2xl font-semibold money">{formatter.format(month.spent)}</p>
                </div>
                <div className="rounded-2xl bg-income-soft p-3">
                    <p className="text-xs font-extrabold uppercase tracking-wider text-income-ink">Came in</p>
                    <p className="font-display text-2xl font-semibold money">{formatter.format(month.income)}</p>
                </div>
            </div>
            <PaceChart pace={month.pace} lastMonthPace={month.lastMonthPace} daysInMonth={month.daysInMonth}/>
            <p className="text-sm font-semibold text-muted-foreground">
                {Math.abs(difference) < 0.005
                    ? "Same as this point last month."
                    : difference < 0
                        ? `${formatter.format(-difference)} less than this point last month 🎉`
                        : `${formatter.format(difference)} more than this point last month.`}
            </p>
        </Card>
    );
}

// Spending so far this month against all of last month, as running totals
function PaceChart({pace, lastMonthPace, daysInMonth}: {
    pace: { day: number, total: number }[], lastMonthPace: { day: number, total: number }[], daysInMonth: number
}) {
    const W = 320, H = 120, left = 4, right = 4, top = 8, bottom = 20;
    const lastDay = Math.max(daysInMonth, lastMonthPace.length, 2);
    const maxY = Math.max(1, ...pace.map((p) => p.total), ...lastMonthPace.map((p) => p.total)) * 1.08;
    const x = (day: number) => left + (day - 1) / (lastDay - 1) * (W - left - right);
    const y = (value: number) => top + (1 - value / maxY) * (H - top - bottom);
    const line = (points: { day: number, total: number }[]) => points.map((p) => `${x(p.day).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
    const end = pace[pace.length - 1];

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
             aria-label="Spending this month so far compared with last month">
            <line x1={left} x2={W - right} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={2} strokeLinecap="round"/>
            {lastMonthPace.length > 1 && (
                <polyline points={line(lastMonthPace)} fill="none" className="stroke-muted-foreground/50" strokeWidth={2} strokeDasharray="4 4" strokeLinejoin="round"/>
            )}
            {pace.length > 0 && (
                <>
                    <polygon points={`${x(1)},${y(0)} ${line(pace)} ${x(end.day)},${y(0)}`} className="fill-chart-spend/20"/>
                    <polyline points={line(pace)} fill="none" className="stroke-chart-spend" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round"/>
                    <circle cx={x(end.day)} cy={y(end.total)} r={5} className="fill-chart-spend stroke-card" strokeWidth={2}/>
                </>
            )}
            <text x={left} y={H - 4} className="fill-muted-foreground text-[10px] font-bold">1</text>
            {end && end.day > 3 && end.day < lastDay - 3 && (
                <text x={x(end.day)} y={H - 4} textAnchor="middle" className="fill-foreground text-[10px] font-bold">Today</text>
            )}
            <text x={W - right} y={H - 4} textAnchor="end" className="fill-muted-foreground text-[10px] font-bold">{daysInMonth}</text>
            {lastMonthPace.length > 1 && (
                <text x={W - right} y={Math.max(top + 10, y(lastMonthPace[lastMonthPace.length - 1].total) - 6)} textAnchor="end"
                      className="fill-muted-foreground text-[10px] font-bold">last month</text>
            )}
        </svg>
    );
}

function TopCategories({data, formatter}: { data: HomeData, formatter: Intl.NumberFormat }) {
    const max = Math.max(...data.topCategories.map((c) => c.amount), 1);
    return (
        <Card className="flex flex-col gap-3 p-5">
            <h2 className="font-display text-xl font-semibold">Where it went</h2>
            {data.topCategories.map((c) => (
                <div key={c.categoryId} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-sm font-bold">
                        <span className="flex min-w-0 items-center gap-2">
                            <span role="img" className="text-lg">{c.icon}</span>
                            <span className="truncate">{c.name}</span>
                        </span>
                        <span className="money">{formatter.format(c.amount)}</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-chart-spend" style={{width: `${Math.max(4, c.amount / max * 100)}%`}}/>
                    </div>
                </div>
            ))}
        </Card>
    );
}

function Accounts({data, formatter}: { data: HomeData, formatter: Intl.NumberFormat }) {
    return (
        <Card className="flex flex-col gap-1 p-3 md:p-4">
            <div className="flex items-center justify-between px-2 pb-1">
                <h2 className="font-display text-xl font-semibold">Accounts</h2>
                <Link href="/accounts" className="flex items-center text-sm font-bold text-primary">All<ChevronRight className="h-4 w-4"/></Link>
            </div>
            {data.groups.map((group) => (
                <div key={group.id} className="flex flex-col">
                    <div className="flex items-center justify-between px-2 pb-1 pt-2 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                        <span>{group.label}</span>
                        <span className="money">{formatter.format(group.total)}</span>
                    </div>
                    {group.accounts.map((account) => <AccountLine key={account.id} account={account} formatter={formatter}/>)}
                </div>
            ))}
        </Card>
    );
}

export function AccountLine({account, formatter}: { account: HomeData["groups"][number]["accounts"][number], formatter: Intl.NumberFormat }) {
    const Icon = accountIcon(account.type);
    const check = account.check;
    return (
        <Link href={`/accounts/${account.id}`} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-accent">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-secondary"><Icon className="h-5 w-5"/></span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-bold">{account.name}</span>
                <span className={cn("truncate text-xs font-bold",
                    check.mismatch ? "text-destructive" : check.daysSinceCheck !== null && check.daysSinceCheck < 14 ? "text-primary" : "text-muted-foreground")}>
                    {check.mismatch
                        ? `Off by ${formatter.format(Math.abs(check.mismatch.difference))}`
                        : check.lastCheckedAt
                            ? `${check.daysSinceCheck !== null && check.daysSinceCheck < 14 ? "✓ " : ""}Checked ${dayFormatter.format(new Date(check.lastCheckedAt))}`
                            : "Not checked yet"}
                    {account.type === "cd" && account.maturesOn && ` · matures ${dayFormatter.format(new Date(account.maturesOn))}`}
                    {account.type === "cd" && account.apy != null && ` · ${account.apy}%`}
                </span>
            </span>
            <span className={cn("font-display font-semibold money", account.type === "credit" && account.balance < 0 && "text-spend-ink")}>
                {formatBalance(account, formatter)}
            </span>
        </Link>
    );
}

export default HomeView;
