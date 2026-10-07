'use client';

import React, {ReactNode, useState} from 'react';
import {StickyNote} from "lucide-react";
import TransactionSheet, {useCurrencyFormatter} from "@/app/(dashboard)/_components/TransactionSheet";
import type {TransactionRow} from "@/lib/transactionRows";
import {dayHeading, formatSigned} from "@/lib/money";
import {cn} from "@/lib/utils";

// A transaction as one tappable row. With `effect` (the change to one account) the amount
// is signed for that account and `runningBalance` shows the balance after it.
export type ListRow = TransactionRow & { effect?: number, runningBalance?: number | null };

function kindOf(row: TransactionRow) {
    if (row.type === "transfer") return "move";
    if (row.type === "adjustment") return "adjustment";
    if (row.type === "income") return row.category.type === "expense" ? "refund" : "income";
    return row.category.type === "income" ? "giveback" : "spend";
}

function subtitle(row: TransactionRow) {
    if (row.type === "transfer") return `${row.accountName ?? "?"} → ${row.toAccountName ?? "?"}`;
    if (row.type === "adjustment") return `Balance adjustment · ${row.accountName ?? row.toAccountName ?? ""}`;
    return [row.category.name, row.accountName].filter(Boolean).join(" · ");
}

export function TransactionItem({row, onOpen, showDate}: { row: ListRow, onOpen: (row: ListRow) => void, showDate?: boolean }) {
    const formatter = useCurrencyFormatter();
    const kind = kindOf(row);
    const amount = row.effect !== undefined
        ? formatSigned(row.effect, formatter)
        : kind === "income" || kind === "refund" ? formatSigned(row.amount, formatter)
            : kind === "spend" || kind === "giveback" ? formatSigned(-row.amount, formatter)
                : formatter.format(row.amount);
    const amountColor = row.effect !== undefined
        ? (row.effect > 0 ? "text-income-ink" : "text-foreground")
        : kind === "income" || kind === "refund" ? "text-income-ink" : kind === "move" ? "text-move-ink" : kind === "adjustment" ? "text-muted-foreground" : "text-foreground";
    const bubble = kind === "move" ? "bg-move-soft" : kind === "income" || kind === "refund" ? "bg-income-soft" : kind === "adjustment" ? "bg-secondary" : "bg-spend-soft";

    return (
        <button type="button" onClick={() => onOpen(row)}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-accent active:bg-accent">
            <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl", bubble)} role="img" aria-hidden>
                {row.type === "transfer" ? "🔁" : row.category.icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5">
                    <span className="truncate font-bold">{row.description || row.category.name}</span>
                    {row.needsReview && <span className="h-2 w-2 shrink-0 rounded-full bg-sun" title="Waiting on Sort"/>}
                </span>
                <span className="truncate text-xs font-semibold text-muted-foreground">
                    {showDate && `${new Date(row.date).toLocaleDateString(undefined, {timeZone: "UTC", month: "short", day: "numeric"})} · `}
                    {subtitle(row)}
                    {kind === "refund" && " · money back"}
                </span>
                {row.note && (
                    <span className="mt-1 flex max-w-full items-center gap-1 self-start rounded-xl rounded-bl-sm bg-secondary px-2 py-0.5 text-xs font-semibold">
                        <StickyNote className="h-3 w-3 shrink-0 text-muted-foreground"/>
                        <span className="truncate">{row.note}</span>
                    </span>
                )}
            </span>
            <span className="flex shrink-0 flex-col items-end">
                <span className={cn("font-display text-base font-semibold money", amountColor)}>{amount}</span>
                {row.runningBalance != null && (
                    <span className="text-xs font-semibold text-muted-foreground money">{formatter.format(row.runningBalance)}</span>
                )}
            </span>
        </button>
    );
}

// Rows grouped under day headings, newest first, opening the edit sheet on tap
export function DayGroupedList({rows, empty, renderAfterDay}: {
    rows: ListRow[],
    empty?: ReactNode,
    renderAfterDay?: (day: string) => ReactNode,
}) {
    const [editing, setEditing] = useState<ListRow | null>(null);
    const groups: { day: string, rows: ListRow[] }[] = [];
    for (const row of rows) {
        const day = new Date(row.date).toISOString().slice(0, 10);
        const last = groups[groups.length - 1];
        if (last?.day === day) last.rows.push(row);
        else groups.push({day, rows: [row]});
    }

    if (rows.length === 0) return <>{empty}</>;

    return (
        <div className="flex flex-col gap-4">
            {groups.map((group) => (
                <section key={group.day} className="flex flex-col">
                    <h3 className="sticky top-14 z-10 bg-background/90 px-2 py-1.5 font-sans text-xs font-extrabold uppercase tracking-wider text-muted-foreground backdrop-blur md:top-[72px]">
                        {dayHeading(new Date(`${group.day}T00:00:00Z`))}
                    </h3>
                    {group.rows.map((row) => <TransactionItem key={row.id} row={row} onOpen={setEditing}/>)}
                    {renderAfterDay?.(group.day)}
                </section>
            ))}
            <TransactionSheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} transaction={editing ?? undefined}/>
        </div>
    );
}

// A short list without day headings, for Home
export function CompactList({rows}: { rows: ListRow[] }) {
    const [editing, setEditing] = useState<ListRow | null>(null);
    return (
        <div className="flex flex-col">
            {rows.map((row) => <TransactionItem key={row.id} row={row} onOpen={setEditing} showDate/>)}
            <TransactionSheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} transaction={editing ?? undefined}/>
        </div>
    );
}
