'use client';

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useMutation, useQuery} from "@tanstack/react-query";
import {UserSettings} from "@prisma/client";
import {toast} from "sonner";
import {CalendarDays, ChevronDown, Loader2, StickyNote, Trash2} from "lucide-react";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import CategoryPicker, {PickedCategory, useAllCategories} from "@/app/(dashboard)/_components/CategoryPicker";
import {AccountChips, useAccounts, useRememberedAccount} from "@/app/(dashboard)/_components/AccountPicker";
import {amountToCents, centsToAmount, Keypad, pressKey, useKeyboardDigits} from "@/app/(dashboard)/_components/Keypad";
import SplitEditor, {lineCents, newLine, SplitLine, splitProblem} from "@/app/(dashboard)/_components/SplitEditor";
import {PersonCombobox, PersonValue, usePeople} from "@/app/(dashboard)/_components/PersonPicker";
import {CreateTransfer, DeleteTransaction, EditTransaction, SaveEntry} from "@/app/(dashboard)/_actions/transactions";
import {CreateTransferSchema, EditTransactionSchema} from "@/schema/transaction";
import {DateToUTCDate, GetFormatterForCurrency, ToDayString} from "@/lib/helpers";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";
import type {TransactionRow} from "@/lib/transactionRows";
import type {GetMerchantsResponseType, Merchant} from "@/app/api/merchants/route";
import {cn} from "@/lib/utils";

export type Kind = "expense" | "income" | "transfer";

export const KINDS: { kind: Kind, label: string, verb: string, active: string }[] = [
    {kind: "expense", label: "Spent", verb: "Spent money", active: "bg-spend text-white shadow-[0_3px_0_0_hsl(var(--spend-ink))]"},
    {kind: "income", label: "Got", verb: "Got money", active: "bg-income text-white shadow-[0_3px_0_0_hsl(var(--income-ink))]"},
    {kind: "transfer", label: "Moved", verb: "Moved money", active: "bg-move text-white shadow-[0_3px_0_0_hsl(var(--move-ink))]"},
];

const SOURCE_LABELS: Record<string, string> = {
    import: "Imported from a statement",
    apple_pay: "Logged by Apple Pay",
    shortcut: "Logged with the shortcut",
    plaid: "Synced from your bank",
};

// How the money is filed: one category, split, paid back by someone, or left for the Sort page
type Mode = "category" | "split" | "payback" | "later";

const TOP_CATEGORIES = 4;
const SUGGESTIONS = 5;

export function useCurrencyFormatter() {
    const {data} = useQuery<UserSettings>({
        queryKey: ["userSettings"],
        queryFn: () => fetch("/api/user-settings").then((res) => res.json()),
    });
    return useMemo(() => GetFormatterForCurrency(data?.currency ?? "USD"), [data?.currency]);
}

function useMerchants(enabled: boolean) {
    return useQuery<GetMerchantsResponseType>({
        queryKey: ["merchants"],
        queryFn: () => fetch("/api/merchants").then((res) => res.json()),
        enabled,
        staleTime: 60_000,
    });
}

// The date to store for a day picked in the form: today keeps the time, so it counts after a
// balance checked earlier today; an unchanged day keeps the transaction's own date
function dateForDay(day: string, keep?: Date): Date {
    const [year, month, date] = day.split("-").map(Number);
    if (keep && keep.getUTCFullYear() === year && keep.getUTCMonth() === month - 1 && keep.getUTCDate() === date) return keep;
    const now = new Date();
    if (year === now.getFullYear() && month === now.getMonth() + 1 && date === now.getDate()) return DateToUTCDate(now);
    return new Date(Date.UTC(year, month - 1, date));
}

function dayLabel(day: string) {
    const today = ToDayString(new Date());
    const yesterday = ToDayString(new Date(Date.now() - 24 * 60 * 60 * 1000));
    if (day === today) return "Today";
    if (day === yesterday) return "Yesterday";
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {timeZone: "UTC", month: "short", day: "numeric", year: "numeric"});
}

const personRef = (p: PersonValue) => "id" in p ? {id: p.id} : {name: p.name};
const samePerson = (a: PersonValue | null, b: PersonValue | null) =>
    Boolean(a && b && ("id" in a && "id" in b ? a.id === b.id : a.name.toLowerCase() === b.name.toLowerCase()));

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    // New transaction of this kind...
    kind?: Kind;
    // ...or an existing one to edit
    transaction?: TransactionRow;
}

function TransactionSheet({open, onOpenChange, kind: initialKind = "expense", transaction}: Props) {
    const editing = Boolean(transaction);
    const formatter = useCurrencyFormatter();
    const invalidate = useInvalidateMoney();
    const merchantsQuery = useMerchants(open);
    const merchants = useMemo(() => merchantsQuery.data ?? [], [merchantsQuery.data]);
    const {data: accounts} = useAccounts();
    const {data: categoryList} = useAllCategories();
    const {data: peopleData} = usePeople();

    const [kind, setKind] = useState<Kind>(initialKind);
    const [digits, setDigits] = useState("");
    const [day, setDay] = useState(ToDayString(new Date()));
    const [description, setDescription] = useState("");
    const [note, setNote] = useState("");
    const [showNote, setShowNote] = useState(false);
    const [mode, setMode] = useState<Mode>("category");
    const [category, setCategory] = useState<PickedCategory | null>(null);
    const [lines, setLines] = useState<SplitLine[]>([]);
    const [payer, setPayer] = useState<PersonValue | null>(null);
    const [accountId, setAccountId] = useState<string | null>(null);
    const [toAccountId, setToAccountId] = useState<string | null>(null);
    const [keypad, setKeypad] = useState(true);
    const [suggesting, setSuggesting] = useState(false);
    const [lastTime, setLastTime] = useState<Merchant | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [rememberedAccount, rememberAccount] = useRememberedAccount(`pennywise:${kind}-account`);
    const [rememberedTo, rememberTo] = useRememberedAccount('pennywise:transfer-to');

    const amount = centsToAmount(digits);
    const onKey = useCallback((key: string) => setDigits((d) => pressKey(d, key)), []);
    useKeyboardDigits(open && keypad, onKey);

    // Start every opening from the transaction's current values, or a fresh form
    useEffect(() => {
        if (!open) return;
        setError(null);
        setConfirmDelete(false);
        setSuggesting(false);
        setLastTime(null);
        if (transaction) {
            const k = (transaction.type === "transfer" ? "transfer" : transaction.type === "income" ? "income" : "expense") as Kind;
            setKind(k);
            setDigits(amountToCents(transaction.amount));
            setDay(new Date(transaction.date).toISOString().slice(0, 10));
            setDescription(transaction.description);
            setNote(transaction.note ?? "");
            setShowNote(Boolean(transaction.note));
            setAccountId(transaction.accountId);
            setToAccountId(transaction.toAccountId);
            setKeypad(false);
            const people = transaction.lines.filter((l) => l.person);
            const paidBack = k === "income" && people.length === 1 && transaction.lines.length === 1;
            setPayer(paidBack ? people[0].person : transaction.person);
            setLines(transaction.lines.map((l) => newLine({
                category: l.category ? {name: l.category.name, type: l.category.type as PickedCategory["type"]} : null,
                person: l.person,
                amount: l.amount.toFixed(2),
            })));
            const unsorted = transaction.category.name === "Unsorted";
            setCategory(k === "transfer" || unsorted || transaction.lines.length > 0 ? null
                : {name: transaction.category.name, type: transaction.category.type as PickedCategory["type"]});
            setMode(paidBack ? "payback" : transaction.lines.length > 0 ? "split" : "category");
        } else {
            setKind(initialKind);
            setDigits("");
            setDay(ToDayString(new Date()));
            setDescription("");
            setNote("");
            setShowNote(false);
            setCategory(null);
            setLines([]);
            setPayer(null);
            setMode("category");
            setToAccountId(null);
            setKeypad(true);
        }
    }, [open, transaction, initialKind]);

    // New entries start from the account used last time for this kind
    useEffect(() => {
        if (open && !transaction) setAccountId(rememberedAccount);
    }, [open, transaction, rememberedAccount]);
    useEffect(() => {
        if (open && !transaction && kind === "transfer") setToAccountId(rememberedTo);
    }, [open, transaction, kind, rememberedTo]);

    const changeKind = (next: Kind) => {
        setKind(next);
        setLastTime(null);
        // Spending needs a spending category; money in can keep one as money back
        if (next === "transfer" || (next === "expense" && category?.type === "income")) setCategory(null);
        if (next !== "income" && mode === "payback") setMode("category");
        if (next === "transfer") setMode("category");
    };

    // Places that start with or contain what's typed
    const entryKind = kind === "income" ? "income" : "expense";
    const matches = useMemo(() => {
        const term = description.trim().toLowerCase();
        if (!term) return [];
        const ofKind = merchants.filter((m) => m.type === entryKind && m.name.toLowerCase() !== term);
        return [
            ...ofKind.filter((m) => m.name.toLowerCase().startsWith(term)),
            ...ofKind.filter((m) => !m.name.toLowerCase().startsWith(term) && m.name.toLowerCase().includes(term)),
        ].slice(0, SUGGESTIONS);
    }, [merchants, description, entryKind]);

    const pickMerchant = (merchant: Merchant) => {
        setDescription(merchant.name);
        setSuggesting(false);
        setLastTime(merchant);
        if (merchant.accountId && accounts?.some((a) => a.id === merchant.accountId && !a.archived)) setAccountId(merchant.accountId);
        if (merchant.category && (mode === "category" || mode === "later")) {
            setCategory({name: merchant.category.name, type: merchant.category.type as PickedCategory["type"]});
            setMode("category");
        }
    };

    // Your most used categories for this kind, plus the one picked
    const topCategories = useMemo(() => {
        type Shown = { name: string, type: string, icon: string };
        const counts = new Map<string, { category: Shown, count: number }>();
        for (const m of merchants) {
            if (m.type !== entryKind || !m.category) continue;
            const key = `${m.category.type}:${m.category.name}`;
            const entry = counts.get(key) ?? {category: m.category, count: 0};
            entry.count += m.count;
            counts.set(key, entry);
        }
        let top: Shown[] = [...counts.values()].sort((a, b) => b.count - a.count).map((e) => e.category);
        if (top.length < TOP_CATEGORIES) {
            const more = (categoryList ?? []).filter((c) => c.type === entryKind && c.name !== "Unsorted"
                && !top.some((t) => t.name === c.name && t.type === c.type));
            top = [...top, ...more.map((c) => ({name: c.name, type: c.type, icon: c.icon}))];
        }
        top = top.slice(0, TOP_CATEGORIES);
        if (category && !top.some((t) => t.name === category.name && t.type === category.type)) {
            const full = categoryList?.find((c) => c.name === category.name && c.type === category.type);
            if (full) top = [{name: full.name, type: full.type, icon: full.icon}, ...top.slice(0, TOP_CATEGORIES - 1)];
        }
        return top;
    }, [merchants, categoryList, entryKind, category]);

    // People who owe you, first, for "Paid back"
    const owers = (peopleData?.people ?? []).filter((p) => p.balance > 0);

    const startSplit = () => {
        setMode("split");
        if (lines.length === 0) setLines([newLine({category}), newLine({})]);
    };

    const save = useMutation({
        mutationFn: async () => {
            const date = dateForDay(day, transaction ? new Date(transaction.date) : undefined);
            if (!(amount > 0)) throw new FormError("Type the amount");
            if (kind === "transfer") {
                if (transaction) {
                    const values = {id: transaction.id, type: kind, amount, date, description, accountId, toAccountId, note};
                    const parsed = EditTransactionSchema.safeParse(values);
                    if (!parsed.success) throw new FormError(parsed.error.issues[0]?.message);
                    return EditTransaction(parsed.data);
                }
                const values = {amount, date, description, fromAccountId: accountId ?? "", toAccountId: toAccountId ?? "", note};
                const parsed = CreateTransferSchema.safeParse(values);
                if (!parsed.success) throw new FormError(parsed.error.issues[0]?.message);
                rememberAccount(accountId);
                rememberTo(toAccountId);
                return CreateTransfer(parsed.data);
            }

            let split = null;
            if (mode === "split") {
                const problem = splitProblem(lines, amount);
                if (problem) throw new FormError(problem);
                const cents = lineCents(lines, amount);
                split = lines.map((l, i) => ({
                    amount: cents[i] / 100,
                    category: l.category,
                    person: l.person ? personRef(l.person) : null,
                }));
            }
            if (mode === "payback") {
                if (!payer) throw new FormError("Who paid you back?");
                split = [{amount, category: null, person: personRef(payer)}];
            }
            if (mode === "category" && !category) throw new FormError("Pick a category, or Later");

            const response = await SaveEntry({
                id: transaction?.id,
                type: kind, amount, date, description, note, accountId,
                category: mode === "category" ? category : null,
                lines: split,
                // A new payer is who the money came from; otherwise editing keeps the person on it
                ...(mode === "payback" && payer ? {person: personRef(payer)} : {}),
            });
            if (!response.ok) throw new FormError(response.error);
            if (!transaction) rememberAccount(accountId);
        },
        onSuccess: async () => {
            toast.success(editing ? "Saved" : kind === "transfer" ? "Move recorded" : mode === "later" ? "Logged. Sort it later" : "Logged 💸");
            onOpenChange(false);
            await invalidate();
        },
        onError: (e) => {
            if (e instanceof FormError) setError(e.message);
            else toast.error("Could not save. Try again.");
        },
    });

    const remove = useMutation({
        mutationFn: () => DeleteTransaction({id: transaction!.id}),
        onSuccess: async () => {
            toast.success("Deleted");
            onOpenChange(false);
            await invalidate();
        },
        onError: () => toast.error("Could not delete it"),
    });

    if (transaction?.type === "adjustment") {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[440px]">
                    <DialogHeader>
                        <DialogTitle>⚖️ Balance adjustment</DialogTitle>
                        <DialogDescription>
                            Added when a balance check didn&apos;t match, so the transactions add up to the bank&apos;s balance.
                            It isn&apos;t spending or income. Delete it if you found the missing transaction instead.
                        </DialogDescription>
                    </DialogHeader>
                    <p className="font-display text-3xl font-semibold money">
                        {transaction.toAccountId ? "+" : "−"}{formatter.format(transaction.amount)}
                    </p>
                    <DialogFooter>
                        <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
                            {remove.isPending ? <Loader2 className="animate-spin"/> : <Trash2/>}Delete adjustment
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }

    const accountLabel = kind === "income" ? "Paid into" : kind === "transfer" ? "From" : "Paid with";
    const chip = (selected: boolean) => cn(
        "flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-sm font-bold transition-colors",
        selected ? "border-primary bg-primary-soft text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="gap-3 sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{editing ? "Edit transaction" : KINDS.find((k) => k.kind === kind)!.verb}</DialogTitle>
                    {transaction && SOURCE_LABELS[transaction.entrySource] && (
                        <DialogDescription>{transaction.source ? `Synced from ${transaction.source}` : SOURCE_LABELS[transaction.entrySource]}</DialogDescription>
                    )}
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={(e) => {
                    e.preventDefault();
                    setError(null);
                    save.mutate();
                }}>
                    <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-secondary p-1.5" role="radiogroup" aria-label="Kind">
                        {KINDS.map((k) => (
                            <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind}
                                    onClick={() => changeKind(k.kind)}
                                    className={cn("rounded-xl py-2 text-sm font-extrabold transition-colors",
                                        kind === k.kind ? k.active : "text-muted-foreground hover:text-foreground")}>
                                {k.label}
                            </button>
                        ))}
                    </div>

                    <button type="button" onClick={() => setKeypad(true)} aria-label="Amount"
                            className="flex flex-col items-center font-display">
                        <span className={cn("text-5xl font-semibold tracking-tight money", !digits && "text-muted-foreground/50")}>
                            {formatter.format(amount)}
                        </span>
                        {!keypad && <span className="text-xs font-bold text-muted-foreground">Tap to change</span>}
                    </button>
                    {keypad && <Keypad onKey={onKey}/>}

                    <div className="relative flex flex-col gap-1.5">
                        <Label htmlFor="tx-description" className="sr-only">
                            {kind === "transfer" ? "What for" : kind === "income" ? "From who or what" : "Where"}
                        </Label>
                        <Input id="tx-description" value={description} autoComplete="off" maxLength={191}
                               placeholder={kind === "transfer" ? "What for (optional), e.g. Discover payment"
                                   : kind === "income" ? "From who or what, e.g. Paycheck" : "Where, e.g. Walmart"}
                               onFocus={() => {
                                   setKeypad(false);
                                   setSuggesting(true);
                               }}
                               onBlur={() => setTimeout(() => setSuggesting(false), 150)}
                               onChange={(e) => {
                                   setDescription(e.target.value);
                                   setSuggesting(true);
                                   setLastTime(null);
                               }}/>
                        {suggesting && kind !== "transfer" && matches.length > 0 && (
                            <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border-2 bg-popover shadow-lg">
                                {matches.map((m) => (
                                    <button key={`${m.type}:${m.name}`} type="button"
                                            onMouseDown={(e) => e.preventDefault()} onClick={() => pickMerchant(m)}
                                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent">
                                        <span role="img" aria-hidden>{m.category?.icon ?? "📍"}</span>
                                        <span className="flex-1 truncate font-bold">{m.name}</span>
                                        <span className="truncate text-xs text-muted-foreground">
                                            {[accounts?.find((a) => a.id === m.accountId)?.name, m.category?.name].filter(Boolean).join(" · ")}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {lastTime && (lastTime.accountId || lastTime.category) && (
                            <p className="text-xs font-semibold text-muted-foreground">
                                Last time: {[accounts?.find((a) => a.id === lastTime.accountId)?.name, lastTime.category?.name].filter(Boolean).join(" · ")}
                            </p>
                        )}
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>{accountLabel}</Label>
                        <AccountChips label={accountLabel} value={accountId} onChange={setAccountId} allowNone={kind !== "transfer"}
                                      excludeTypes={kind === "expense" ? ["cd"] : undefined}/>
                    </div>
                    {kind === "transfer" && (
                        <div className="flex flex-col gap-2">
                            <Label>To</Label>
                            <AccountChips label="To" value={toAccountId} onChange={setToAccountId} excludeId={accountId}/>
                        </div>
                    )}

                    {kind !== "transfer" && (
                        <div className="flex flex-col gap-2">
                            <Label>{mode === "split" ? "Split" : "Category"}</Label>
                            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
                                {topCategories.map((c) => {
                                    const selected = mode === "category" && category?.name === c.name && category.type === c.type;
                                    return (
                                        <button key={`${c.type}:${c.name}`} type="button" role="radio" aria-checked={selected}
                                                className={chip(selected)}
                                                onClick={() => {
                                                    setCategory({name: c.name, type: c.type as PickedCategory["type"]});
                                                    setMode("category");
                                                }}>
                                            <span role="img" aria-hidden>{c.icon}</span>{c.name}
                                        </button>
                                    );
                                })}
                                <CategoryPicker kind={entryKind} value={category} onChange={(c) => {
                                    setCategory(c);
                                    setMode("category");
                                }} trigger={
                                    <button type="button" className={chip(false)}>More<ChevronDown className="h-4 w-4"/></button>
                                }/>
                                {kind === "income" && (
                                    <button type="button" role="radio" aria-checked={mode === "payback"} className={chip(mode === "payback")}
                                            onClick={() => {
                                                setMode("payback");
                                                if (!payer && transaction?.person) setPayer(transaction.person);
                                            }}>
                                        <span role="img" aria-hidden>↩️</span>Paid back
                                    </button>
                                )}
                                <button type="button" role="radio" aria-checked={mode === "split"} className={chip(mode === "split")}
                                        onClick={startSplit}>
                                    <span role="img" aria-hidden>✂️</span>Split
                                </button>
                                <button type="button" role="radio" aria-checked={mode === "later"} className={chip(mode === "later")}
                                        onClick={() => setMode("later")}>
                                    <span role="img" aria-hidden>⏳</span>Later
                                </button>
                            </div>
                            {mode === "category" && category && !topCategories.some((t) => t.name === category.name && t.type === category.type) && (
                                <p className="text-xs font-semibold text-muted-foreground">Category: {category.name}</p>
                            )}
                            {kind === "income" && mode === "category" && category?.type === "expense" && (
                                <p className="text-xs text-muted-foreground">Money back: it lowers your {category.name} spending instead of counting as income.</p>
                            )}
                            {mode === "later" && (
                                <p className="text-xs text-muted-foreground">It waits on the Sort page until you pick a category.</p>
                            )}
                            {mode === "payback" && (
                                <div className="flex flex-col gap-2 rounded-2xl bg-income-soft p-3">
                                    {owers.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {owers.slice(0, 4).map((p) => (
                                                <button key={p.id} type="button" className={chip(samePerson(payer, {id: p.id, name: p.name}))}
                                                        onClick={() => setPayer({id: p.id, name: p.name})}>
                                                    {p.name} <span className="money">owes {formatter.format(p.balance)}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <PersonCombobox value={payer} onChange={setPayer} placeholder="Who paid you back?"/>
                                    <p className="text-xs text-income-ink">
                                        It settles what they owe you, and isn&apos;t income. Nothing on record? Pick the category it was for instead,
                                        and it lowers that spending.
                                    </p>
                                </div>
                            )}
                            {mode === "split" && (
                                <SplitEditor kind={entryKind} total={amount} lines={lines} onChange={setLines} formatter={formatter}/>
                            )}
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        <label className={cn(chip(false), "relative cursor-pointer")}>
                            <CalendarDays className="h-4 w-4"/>{dayLabel(day)}
                            <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} required
                                   aria-label="Date" className="absolute inset-0 cursor-pointer opacity-0"/>
                        </label>
                        {!showNote && (
                            <button type="button" className={chip(false)} onClick={() => {
                                setShowNote(true);
                                setKeypad(false);
                            }}>
                                <StickyNote className="h-4 w-4"/>Add a note
                            </button>
                        )}
                    </div>
                    {showNote && (
                        <Input value={note} onChange={(e) => setNote(e.target.value)} onFocus={() => setKeypad(false)}
                               placeholder="Note, e.g. dinner with Alex" maxLength={500} aria-label="Note" autoFocus={!editing}/>
                    )}

                    {error && <p className="rounded-2xl bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive">{error}</p>}

                    <DialogFooter className="items-stretch">
                        {transaction && (
                            <Button type="button" variant={confirmDelete ? "destructive" : "outline"} className="sm:mr-auto"
                                    disabled={remove.isPending}
                                    onClick={() => confirmDelete ? remove.mutate() : setConfirmDelete(true)}>
                                {remove.isPending ? <Loader2 className="animate-spin"/> : <Trash2/>}
                                {confirmDelete ? "Tap again to delete" : "Delete"}
                            </Button>
                        )}
                        <Button type="submit" size="lg" disabled={save.isPending}>
                            {save.isPending ? <Loader2 className="animate-spin"/> : editing ? "Save" : "Save it"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

class FormError extends Error {
    constructor(message?: string) {
        super(message ?? "Check the form");
    }
}

export default TransactionSheet;
