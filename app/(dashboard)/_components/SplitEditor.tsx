'use client';

import React from 'react';
import {Plus, Tag, UserPlus, Users, X} from "lucide-react";
import CategoryPicker from "@/app/(dashboard)/_components/CategoryPicker";
import {PersonCombobox} from "@/app/(dashboard)/_components/PersonPicker";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";
import {lineCents, newLine, SplitLine, splitEvenly, SplitPerson} from "@/lib/split";

export {lineCents, newLine, splitProblem} from "@/lib/split";
export type {SplitLine} from "@/lib/split";

// Divides one payment between categories (your shares) and people (theirs). The last line
// takes whatever is left, so the parts always add up to the total.

type Props = {
    kind: "income" | "expense";
    total: number;
    lines: SplitLine[];
    onChange: (lines: SplitLine[]) => void;
    formatter: Intl.NumberFormat;
};

export default function SplitEditor({kind, total, lines, onChange, formatter}: Props) {
    const cents = lineCents(lines, total);
    const update = (key: string, fields: Partial<SplitLine>) =>
        onChange(lines.map((l) => l.key === key ? {...l, ...fields} : l));
    const remove = (key: string) => onChange(lines.filter((l) => l.key !== key));
    // New parts go before the last line, which keeps taking what's left
    const add = (line: SplitLine) => onChange([...lines.slice(0, -1), line, ...lines.slice(-1)]);
    const evenWith = (person: SplitPerson) => {
        const people = [...lines.filter((l) => l.person).map((l) => l.person!), person];
        const mine = lines.find((l) => l.category)?.category ?? null;
        onChange(splitEvenly(total, mine, people));
    };

    const mineLines = lines.map((l, i) => ({l, cents: cents[i]})).filter(({l}) => l.category);
    const theirLines = lines.map((l, i) => ({l, cents: cents[i]})).filter(({l}) => l.person);

    return (
        <div className="flex flex-col gap-2">
            {lines.map((line, i) => {
                const last = i === lines.length - 1;
                return (
                    <div key={line.key} className="flex items-center gap-2">
                        {line.person ? (
                            <PersonCombobox value={line.person} onChange={(person) => update(line.key, {person})}/>
                        ) : (
                            <div className="min-w-0 flex-1">
                                <CategoryPicker kind={kind} value={line.category} onChange={(category) => update(line.key, {category})}/>
                            </div>
                        )}
                        {last ? (
                            <span className={cn("w-24 shrink-0 rounded-2xl bg-secondary px-3 py-2 text-right text-sm font-bold money",
                                cents[i] <= 0 && "text-destructive")} title="Whatever is left">
                                {(cents[i] / 100).toFixed(2)}
                            </span>
                        ) : (
                            <input value={line.amount} inputMode="decimal" placeholder="0.00" aria-label="Part amount"
                                   onChange={(e) => update(line.key, {amount: e.target.value.replace(/[^0-9.]/g, "")})}
                                   className="w-24 shrink-0 rounded-2xl border-2 bg-card px-3 py-2 text-right text-sm font-bold outline-none focus:border-primary money"/>
                        )}
                        <button type="button" onClick={() => remove(line.key)} aria-label="Remove this part"
                                disabled={lines.length <= 1}
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent disabled:opacity-30">
                            <X className="h-4 w-4"/>
                        </button>
                    </div>
                );
            })}

            <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => add(newLine({}))}>
                    <Tag/>Category
                </Button>
                <PersonCombobox value={null} onChange={(person) => add(newLine({person}))}
                                trigger={<Button type="button" variant="outline" size="sm"><UserPlus/>Person&apos;s share</Button>}/>
                {kind === "expense" && (
                    <PersonCombobox value={null} onChange={evenWith}
                                    trigger={<Button type="button" variant="outline" size="sm"><Users/>Split evenly with…</Button>}/>
                )}
            </div>

            <div className="rounded-2xl bg-secondary p-3 text-xs font-semibold text-muted-foreground">
                <p className="mb-1 font-extrabold uppercase tracking-wider">How it counts</p>
                {mineLines.length > 0 && (
                    <p>{kind === "expense" ? "Your spending" : "For you"}: {mineLines.map(({l, cents: c}) =>
                        `${l.category?.name ?? "?"} ${formatter.format(c / 100)}`).join(", ")}</p>
                )}
                {theirLines.map(({l, cents: c}) => (
                    <p key={l.key}>
                        {l.person!.name} {kind === "expense" ? "owes you" : "owes you less by"} {formatter.format(Math.max(0, c) / 100)}
                        {kind === "expense" ? " more" : ""}
                    </p>
                ))}
                <p className="mt-1 flex items-center gap-1"><Plus className="h-3 w-3"/>The last line takes whatever is left.</p>
            </div>
        </div>
    );
}
