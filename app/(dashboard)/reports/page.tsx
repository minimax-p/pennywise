'use client';

import React, {useMemo, useState} from 'react';
import Link from "next/link";
import {useQuery} from "@tanstack/react-query";
import {ChevronLeft, ChevronRight, Table2} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Card} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {useCurrencyFormatter} from "@/app/(dashboard)/_components/TransactionSheet";
import type {GetBalanceStatsResponseType} from "@/app/api/stats/balance/route";
import type {GetCategoriesStatsResponseType} from "@/app/api/stats/categories/route";
import type {GetHistoryDataResponseType} from "@/app/api/history-data/route";
import {cn} from "@/lib/utils";

type Mode = "month" | "year";
type Period = { year: number, month: number };

const monthLabel = new Intl.DateTimeFormat(undefined, {timeZone: "UTC", month: "long", year: "numeric"});
const shortMonth = new Intl.DateTimeFormat(undefined, {timeZone: "UTC", month: "short"});

// Transaction dates keep the local calendar day in their UTC fields
function bounds(mode: Mode, {year, month}: Period) {
    const from = mode === "year" ? new Date(Date.UTC(year, 0, 1)) : new Date(Date.UTC(year, month, 1));
    const to = mode === "year" ? new Date(Date.UTC(year + 1, 0, 1) - 1) : new Date(Date.UTC(year, month + 1, 1) - 1);
    return {from, to};
}

function ReportsPage() {
    const now = new Date();
    const [mode, setMode] = useState<Mode>("month");
    const [period, setPeriod] = useState<Period>({year: now.getFullYear(), month: now.getMonth()});
    const formatter = useCurrencyFormatter();
    const {from, to} = bounds(mode, period);
    const range = `from=${from.toISOString()}&to=${to.toISOString()}`;

    const totals = useQuery<GetBalanceStatsResponseType>({
        queryKey: ['reports', 'totals', range],
        queryFn: () => fetch(`/api/stats/balance?${range}`).then((res) => res.json()),
    });
    const categories = useQuery<GetCategoriesStatsResponseType>({
        queryKey: ['reports', 'categories', range],
        queryFn: () => fetch(`/api/stats/categories?${range}`).then((res) => res.json()),
    });
    const history = useQuery<GetHistoryDataResponseType>({
        queryKey: ['reports', 'history', mode, period],
        queryFn: () => fetch(`/api/history-data?timeframe=${mode}&year=${period.year}&month=${period.month}`).then((res) => res.json()),
    });

    const step = (direction: number) => setPeriod(({year, month}) => mode === "year"
        ? {year: year + direction, month}
        : {year: month + direction < 0 ? year - 1 : month + direction > 11 ? year + 1 : year, month: (month + direction + 12) % 12});

    const spent = totals.data?.expense ?? 0;
    const income = totals.data?.income ?? 0;
    const left = income - spent;
    const label = mode === "year" ? String(period.year) : monthLabel.format(from);
    const transactionsLink = (q?: string) => {
        const day = (d: Date) => d.toISOString().slice(0, 10);
        return `/transactions?from=${day(from)}&to=${day(to)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    };

    return (
        <>
            <PageHeader title="Reports" subtitle="Where your money went, month by month"/>
            <div className="container flex flex-col gap-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-secondary p-1.5" role="radiogroup" aria-label="Period">
                        {(["month", "year"] as Mode[]).map((m) => (
                            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                                    className={cn("rounded-xl px-4 py-1.5 text-sm font-bold capitalize",
                                        mode === m ? "bg-card shadow-sm" : "text-muted-foreground")}>
                                {m}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" aria-label="Earlier" onClick={() => step(-1)}><ChevronLeft/></Button>
                        <span className="min-w-[9.5rem] text-center font-display text-lg font-semibold">{label}</span>
                        <Button variant="ghost" size="icon" aria-label="Later" onClick={() => step(1)}><ChevronRight/></Button>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <Total label="Spent" value={formatter.format(spent)} tone="bg-spend-soft text-spend-ink" loading={totals.isLoading}/>
                    <Total label="Came in" value={formatter.format(income)} tone="bg-income-soft text-income-ink" loading={totals.isLoading}/>
                    <Total label={left >= 0 ? "Left over" : "Overspent"} value={formatter.format(Math.abs(left))}
                           tone={left >= 0 ? "bg-primary-soft text-primary" : "bg-destructive/10 text-destructive"} loading={totals.isLoading}/>
                </div>

                <SkeletonWrapper isLoading={history.isLoading}>
                    <Card className="flex flex-col gap-3 p-4 md:p-5">
                        <PeriodChart mode={mode} points={Array.isArray(history.data) ? history.data : []} formatter={formatter}/>
                    </Card>
                </SkeletonWrapper>

                <div className="grid gap-4 md:grid-cols-2">
                    <SkeletonWrapper isLoading={categories.isLoading}>
                        <CategoryBreakdown title="Spending" rows={categories.data?.spending ?? []} total={spent}
                                           barClass="bg-chart-spend" formatter={formatter} link={transactionsLink}/>
                    </SkeletonWrapper>
                    <SkeletonWrapper isLoading={categories.isLoading}>
                        <CategoryBreakdown title="Money in" rows={categories.data?.income ?? []} total={income}
                                           barClass="bg-chart-income" formatter={formatter} link={transactionsLink}/>
                    </SkeletonWrapper>
                </div>
                <p className="text-center text-xs font-semibold text-muted-foreground">
                    Moves between your accounts aren&apos;t spending or income. Refunds and paybacks lower the category they were for.
                </p>
            </div>
        </>
    );
}

function Total({label, value, tone, loading}: { label: string, value: string, tone: string, loading: boolean }) {
    return (
        <div className={cn("flex flex-col gap-0.5 rounded-3xl p-3 md:p-4", tone)}>
            <span className="text-[11px] font-extrabold uppercase tracking-wider">{label}</span>
            <span className={cn("font-display text-lg font-semibold text-foreground money md:text-2xl", loading && "opacity-40")}>{value}</span>
        </div>
    );
}

// Rounds up to a tidy axis maximum: 1, 2 or 5 times a power of ten
function niceMax(value: number) {
    if (value <= 0) return 100;
    const power = 10 ** Math.floor(Math.log10(value));
    return ([1, 2, 5, 10].map((m) => m * power).find((m) => m >= value) ?? 10 * power);
}

// Months of a year (spending and money in side by side) or days of a month (spending)
function PeriodChart({mode, points, formatter}: {
    mode: Mode, points: GetHistoryDataResponseType, formatter: Intl.NumberFormat
}) {
    const [hover, setHover] = useState<number | null>(null);
    const [showTable, setShowTable] = useState(false);
    const both = mode === "year";
    const max = useMemo(() => niceMax(Math.max(0, ...points.map((p) => both ? Math.max(p.expense, p.income) : p.expense))), [points, both]);

    if (points.length === 0) {
        return <p className="py-10 text-center font-semibold text-muted-foreground">Nothing in this period yet.</p>;
    }

    const W = 640, H = 220, left = 44, right = 8, top = 12, bottom = 24;
    const plotW = W - left - right, plotH = H - top - bottom;
    const slot = plotW / points.length;
    const barW = Math.max(3, Math.min(both ? 14 : 12, (slot - 4) / (both ? 2 : 1) - (both ? 1 : 0)));
    const y = (v: number) => top + plotH * (1 - Math.max(0, v) / max);
    const name = (i: number) => both ? shortMonth.format(new Date(Date.UTC(2000, points[i].month, 1))) : String(points[i].day);
    const compact = new Intl.NumberFormat(undefined, {notation: "compact", maximumFractionDigits: 1});

    // A bar with rounded top corners, sitting on the baseline
    const bar = (x: number, value: number) => {
        const h = Math.max(0, y(0) - y(value));
        if (h < 0.5) return "";
        const r = Math.min(4, h, barW / 2);
        const yTop = y(0) - h;
        return `M${x},${y(0)} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${y(0)} Z`;
    };
    const hovered = hover !== null ? points[hover] : null;
    // Label every month, and every fifth day
    const showTick = (i: number) => both || i === 0 || (i + 1) % 5 === 0;

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-xl font-semibold">{both ? "Each month" : "Spending each day"}</h2>
                <div className="flex items-center gap-3 text-xs font-bold text-muted-foreground">
                    {both && (
                        <>
                            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-chart-spend"/>Spent</span>
                            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-chart-income"/>Came in</span>
                        </>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
                        <Table2/>{showTable ? "Chart" : "Numbers"}
                    </Button>
                </div>
            </div>
            {showTable ? (
                <div className="max-h-80 overflow-y-auto rounded-2xl border-2">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-secondary text-xs uppercase tracking-wider text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 text-left">{both ? "Month" : "Day"}</th>
                                <th className="px-3 py-2 text-right">Spent</th>
                                {both && <th className="px-3 py-2 text-right">Came in</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {points.map((p, i) => (
                                <tr key={i} className="border-t">
                                    <td className="px-3 py-1.5 font-semibold">{name(i)}</td>
                                    <td className="px-3 py-1.5 text-right money">{formatter.format(p.expense)}</td>
                                    {both && <td className="px-3 py-1.5 text-right money">{formatter.format(p.income)}</td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="relative">
                    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-pan-y" role="img"
                         aria-label={both ? "Spending and money in for each month" : "Spending for each day"}
                         onPointerLeave={() => setHover(null)}>
                        {[0, 0.5, 1].map((f) => (
                            <g key={f}>
                                <line x1={left} x2={W - right} y1={y(max * f)} y2={y(max * f)}
                                      className={f === 0 ? "stroke-border" : "stroke-border/60"} strokeWidth={f === 0 ? 2 : 1}
                                      strokeDasharray={f === 0 ? undefined : "3 4"}/>
                                <text x={left - 6} y={y(max * f) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] font-bold">
                                    {compact.format(max * f)}
                                </text>
                            </g>
                        ))}
                        {points.map((p, i) => {
                            const x0 = left + slot * i + (slot - (both ? barW * 2 + 2 : barW)) / 2;
                            return (
                                <g key={i}>
                                    {hover === i && <rect x={left + slot * i} y={top} width={slot} height={plotH} rx={6} className="fill-accent"/>}
                                    <path d={bar(x0, p.expense)} className="fill-chart-spend"/>
                                    {both && <path d={bar(x0 + barW + 2, p.income)} className="fill-chart-income"/>}
                                    {showTick(i) && (
                                        <text x={left + slot * i + slot / 2} y={H - 6} textAnchor="middle"
                                              className="fill-muted-foreground text-[11px] font-bold">{name(i)}</text>
                                    )}
                                    {/* Bigger than the bars, so thin ones are easy to hit */}
                                    <rect x={left + slot * i} y={top} width={slot} height={plotH + bottom} fill="transparent"
                                          onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}/>
                                </g>
                            );
                        })}
                    </svg>
                    {hovered && hover !== null && (
                        <div className="pointer-events-none absolute top-0 z-10 rounded-2xl border-2 bg-card px-3 py-2 text-xs font-bold shadow-lg"
                             style={{left: `${Math.min(78, Math.max(2, (left + slot * hover) / W * 100))}%`}}>
                            <p className="mb-1 font-display text-sm">{both ? name(hover) : `Day ${hovered.day}`}</p>
                            <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-chart-spend"/>Spent {formatter.format(hovered.expense)}</p>
                            {both && <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-chart-income"/>Came in {formatter.format(hovered.income)}</p>}
                        </div>
                    )}
                </div>
            )}
        </>
    );
}

function CategoryBreakdown({title, rows, total, barClass, formatter, link}: {
    title: string,
    rows: GetCategoriesStatsResponseType["spending"],
    total: number,
    barClass: string,
    formatter: Intl.NumberFormat,
    link: (q?: string) => string,
}) {
    const max = Math.max(1, ...rows.map((r) => r.amount));
    return (
        <Card className="flex flex-col gap-1 p-3 md:p-4">
            <h2 className="px-2 pb-1 font-display text-xl font-semibold">{title}</h2>
            {rows.length === 0 && <p className="px-2 pb-2 text-sm font-semibold text-muted-foreground">Nothing yet.</p>}
            {rows.map((row) => (
                <Link key={row.categoryId} href={link(row.name)} className="flex flex-col gap-1 rounded-2xl px-2 py-2 hover:bg-accent">
                    <div className="flex items-center justify-between gap-2 text-sm font-bold">
                        <span className="flex min-w-0 items-center gap-2">
                            <span role="img" className="text-lg">{row.icon}</span>
                            <span className="truncate">{row.name}</span>
                        </span>
                        <span className="flex shrink-0 items-baseline gap-2">
                            <span className="text-xs text-muted-foreground">{total > 0 ? `${Math.round(row.amount / total * 100)}%` : ""}</span>
                            <span className="money">{formatter.format(row.amount)}</span>
                        </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
                        <div className={cn("h-full rounded-full", barClass)} style={{width: `${Math.max(3, row.amount / max * 100)}%`}}/>
                    </div>
                </Link>
            ))}
        </Card>
    );
}

export default ReportsPage;
