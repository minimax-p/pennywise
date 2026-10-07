'use client';

import React, {useEffect, useMemo, useState} from 'react';
import {useMutation, useQuery} from "@tanstack/react-query";
import {UserSettings} from "@prisma/client";
import {toast} from "sonner";
import {Loader2, Trash2} from "lucide-react";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import CategoryPicker, {PickedCategory} from "@/app/(dashboard)/_components/CategoryPicker";
import {AccountChips, useRememberedAccount} from "@/app/(dashboard)/_components/AccountPicker";
import {CreateTransaction, CreateTransfer, DeleteTransaction, EditTransaction} from "@/app/(dashboard)/_actions/transactions";
import {CreateTransactionSchema, CreateTransferSchema, EditTransactionSchema} from "@/schema/transaction";
import {DateToUTCDate, GetFormatterForCurrency, ToDayString} from "@/lib/helpers";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";
import type {TransactionRow} from "@/lib/transactionRows";
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
    plaid: "Synced from your bank",
};

export function useCurrencyFormatter() {
    const {data} = useQuery<UserSettings>({
        queryKey: ["userSettings"],
        queryFn: () => fetch("/api/user-settings").then((res) => res.json()),
    });
    return useMemo(() => GetFormatterForCurrency(data?.currency ?? "USD"), [data?.currency]);
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
    const currencySymbol = formatter.formatToParts(0).find((p) => p.type === "currency")?.value ?? "$";
    const invalidate = useInvalidateMoney();

    const [kind, setKind] = useState<Kind>(initialKind);
    const [amount, setAmount] = useState("");
    const [day, setDay] = useState(ToDayString(new Date()));
    const [description, setDescription] = useState("");
    const [note, setNote] = useState("");
    const [category, setCategory] = useState<PickedCategory | null>(null);
    const [accountId, setAccountId] = useState<string | null>(null);
    const [toAccountId, setToAccountId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [rememberedAccount, rememberAccount] = useRememberedAccount(`pennywise:${kind}-account`);
    const [rememberedTo, rememberTo] = useRememberedAccount('pennywise:transfer-to');

    // Start every opening from the transaction's current values, or a fresh form
    useEffect(() => {
        if (!open) return;
        setError(null);
        setConfirmDelete(false);
        if (transaction) {
            const k = (transaction.type === "transfer" ? "transfer" : transaction.type === "income" ? "income" : "expense") as Kind;
            setKind(k);
            setAmount(String(transaction.amount));
            setDay(new Date(transaction.date).toISOString().slice(0, 10));
            setDescription(transaction.description);
            setNote(transaction.note ?? "");
            setCategory(k === "transfer" ? null : {name: transaction.category.name, type: transaction.category.type as PickedCategory["type"]});
            setAccountId(transaction.accountId);
            setToAccountId(transaction.toAccountId);
        } else {
            setKind(initialKind);
            setAmount("");
            setDay(ToDayString(new Date()));
            setDescription("");
            setNote("");
            setCategory(null);
            setToAccountId(null);
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
        // Spending needs a spending category; money in can keep one as money back
        if (next === "transfer" || (next === "expense" && category?.type === "income")) setCategory(null);
    };

    const save = useMutation({
        mutationFn: async () => {
            const date = dateForDay(day, transaction ? new Date(transaction.date) : undefined);
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
            if (!category) throw new FormError("Pick a category");
            const fields = {
                amount, date, description, note, accountId, type: kind,
                category: category.name, categoryType: category.type,
            };
            if (transaction) {
                const values = {...fields, id: transaction.id, toAccountId: null};
                const parsed = EditTransactionSchema.safeParse(values);
                if (!parsed.success) throw new FormError(parsed.error.issues[0]?.message);
                return EditTransaction(parsed.data);
            }
            const parsed = CreateTransactionSchema.safeParse(fields);
            if (!parsed.success) throw new FormError(parsed.error.issues[0]?.message);
            rememberAccount(accountId);
            return CreateTransaction(parsed.data);
        },
        onSuccess: async () => {
            toast.success(editing ? "Saved" : kind === "transfer" ? "Move recorded" : "Logged 💸");
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>{editing ? "Edit transaction" : KINDS.find((k) => k.kind === kind)!.verb}</DialogTitle>
                    {transaction && SOURCE_LABELS[transaction.entrySource] && (
                        <DialogDescription>{transaction.source ? `Synced from ${transaction.source}` : SOURCE_LABELS[transaction.entrySource]}</DialogDescription>
                    )}
                </DialogHeader>
                <form className="flex flex-col gap-5" onSubmit={(e) => {
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

                    <label className="flex items-baseline justify-center gap-1 font-display">
                        <span className="text-3xl font-semibold text-muted-foreground">{currencySymbol}</span>
                        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                               inputMode="decimal" placeholder="0.00" aria-label="Amount" autoFocus={!editing}
                               className="w-48 bg-transparent text-center text-5xl font-semibold outline-none placeholder:text-muted-foreground/40 money"/>
                    </label>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="tx-description">{kind === "transfer" ? "What for (optional)" : kind === "income" ? "From who or what" : "Where"}</Label>
                        <Input id="tx-description" value={description} onChange={(e) => setDescription(e.target.value)}
                               placeholder={kind === "transfer" ? "e.g. Discover payment" : kind === "income" ? "e.g. Paycheck" : "e.g. Walmart"} maxLength={191}/>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>{accountLabel}</Label>
                        <AccountChips label={accountLabel} value={accountId} onChange={setAccountId} allowNone={kind !== "transfer"}/>
                    </div>
                    {kind === "transfer" && (
                        <div className="flex flex-col gap-2">
                            <Label>To</Label>
                            <AccountChips label="To" value={toAccountId} onChange={setToAccountId} excludeId={accountId}/>
                        </div>
                    )}

                    {kind !== "transfer" && (
                        <div className="flex flex-col gap-2">
                            <Label>Category</Label>
                            <CategoryPicker kind={kind} value={category} onChange={setCategory}/>
                            {kind === "income" && (
                                <p className="text-xs text-muted-foreground">
                                    A refund or a friend paying you back? Pick the spending category it was for, and it lowers that spending instead of counting as income.
                                </p>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="tx-day">Date</Label>
                            <Input id="tx-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} required/>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="tx-note">Note</Label>
                            <Input id="tx-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={500}/>
                        </div>
                    </div>

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
