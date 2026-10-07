'use client';

import React, {useEffect, useState} from 'react';
import {useMutation} from "@tanstack/react-query";
import {toast} from "sonner";
import {CheckCircle2, Loader2, TriangleAlert} from "lucide-react";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {BalanceCheckResult, CheckBalance} from "@/app/(dashboard)/_actions/accounts";
import {useCurrencyFormatter} from "@/app/(dashboard)/_components/TransactionSheet";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";
import {BalanceDateFromDay, ToDayString} from "@/lib/helpers";
import {dayFormatter} from "@/lib/money";
import {cn} from "@/lib/utils";

type Props = {
    account: { id: string, name: string, type: string, institution: string | null };
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

// The bank's balance minus Pennywise's is negative when money left that Pennywise doesn't know about
function missingHint(difference: number, owes: boolean, bank: string) {
    if (owes) {
        return difference < 0
            ? `${bank} says you owe more, so a purchase or fee may be missing`
            : `${bank} says you owe less, so a payment or refund may be missing`;
    }
    return difference < 0
        ? `${bank} has less, so a purchase or fee may be missing`
        : `${bank} has more, so a deposit or refund may be missing`;
}

// Type what the bank shows, see whether Pennywise agrees, and save it as a balance check
function BalanceCheckSheet({account, open, onOpenChange}: Props) {
    const formatter = useCurrencyFormatter();
    const invalidate = useInvalidateMoney();
    const owes = account.type === "credit";
    const cash = account.type === "cash";
    const bank = cash ? "your wallet" : account.institution || "your bank";
    const [amount, setAmount] = useState("");
    const [day, setDay] = useState(ToDayString(new Date()));
    const [result, setResult] = useState<BalanceCheckResult | null>(null);

    useEffect(() => {
        if (open) {
            setAmount("");
            setDay(ToDayString(new Date()));
            setResult(null);
        }
    }, [open]);

    const signed = () => {
        const value = Number(amount) || 0;
        return owes ? -Math.abs(value) : value;
    };

    const check = useMutation({
        mutationFn: async ({save, adjust, spend}: { save: boolean, adjust?: boolean, spend?: boolean }) => {
            const response = await CheckBalance({
                accountId: account.id, balance: signed(), balanceDate: BalanceDateFromDay(day), save, adjust, spend,
            });
            if (!response.ok) throw new Error(response.error);
            return response.data;
        },
        onSuccess: async (data) => {
            if (!data.saved) {
                setResult(data);
                return;
            }
            toast.success(Math.abs(data.difference) < 0.005 ? "Checked ✓ It matches" : "Saved the bank's balance");
            onOpenChange(false);
            await invalidate();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not check the balance"),
    });

    const matches = result && Math.abs(result.difference) < 0.005;
    const shown = (value: number) => formatter.format(owes ? -value : value);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                    <DialogTitle>{cash ? `Count your ${account.name.toLowerCase() === "cash" ? "cash" : account.name}` : `Check ${account.name}`}</DialogTitle>
                    <DialogDescription>
                        {cash ? "How much cash is in your wallet right now?"
                            : <>{owes ? `How much does ${bank} say you owe?` : `What balance does ${bank} show?`} Use the current
                                balance, not the available balance.</>}
                    </DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={(e) => {
                    e.preventDefault();
                    check.mutate({save: false});
                }}>
                    <div className="grid grid-cols-[1fr_auto] gap-3">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="check-amount">{owes ? "You owe" : cash ? "You have" : "Balance"}</Label>
                            <Input id="check-amount" inputMode="decimal" placeholder="0.00" autoFocus value={amount}
                                   className="h-14 font-display text-2xl"
                                   onChange={(e) => {
                                       setAmount(e.target.value.replace(/[^0-9.-]/g, ""));
                                       setResult(null);
                                   }}/>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="check-day">As of</Label>
                            <Input id="check-day" type="date" value={day} className="h-14"
                                   onChange={(e) => {
                                       setDay(e.target.value);
                                       setResult(null);
                                   }}/>
                        </div>
                    </div>

                    {!result && (
                        <Button type="submit" size="lg" disabled={!amount || check.isPending}>
                            {check.isPending ? <Loader2 className="animate-spin"/> : "Compare"}
                        </Button>
                    )}

                    {result && matches && (
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-3 rounded-3xl bg-primary-soft p-4 font-bold">
                                <CheckCircle2 className="h-8 w-8 shrink-0 text-primary"/>
                                <span>It matches! Every transaction{result.previousCheckAt ? ` since ${dayFormatter.format(new Date(result.previousCheckAt))}` : ""} adds up.</span>
                            </div>
                            <Button type="button" size="lg" disabled={check.isPending} onClick={() => check.mutate({save: true})}>
                                {check.isPending ? <Loader2 className="animate-spin"/> : "Save check"}
                            </Button>
                        </div>
                    )}

                    {result && !matches && cash && result.difference < 0 && (
                        <div className="flex flex-col gap-3">
                            <div className="flex gap-3 rounded-3xl bg-sun-soft p-4">
                                <span className="text-2xl" role="img" aria-hidden>💵</span>
                                <div className="flex flex-col gap-1 text-sm">
                                    <span className="text-base font-extrabold">
                                        {formatter.format(Math.abs(result.difference))} less than expected
                                    </span>
                                    <span>Pennywise expected {formatter.format(result.expected)}. Probably spent on something you didn&apos;t log.</span>
                                </div>
                            </div>
                            <Button type="button" disabled={check.isPending} onClick={() => check.mutate({save: true, spend: true})}>
                                Count {formatter.format(Math.abs(result.difference))} as cash spending
                            </Button>
                            <Button type="button" variant="outline" disabled={check.isPending}
                                    onClick={() => check.mutate({save: true, adjust: true})}>
                                Just fix the balance
                            </Button>
                            <p className="text-xs text-muted-foreground">
                                Cash spending shows up in your spending as Untracked cash. Fixing the balance doesn&apos;t count as spending.
                            </p>
                        </div>
                    )}

                    {result && !matches && !(cash && result.difference < 0) && (
                        <div className="flex flex-col gap-3">
                            <div className="flex gap-3 rounded-3xl bg-destructive/10 p-4">
                                <TriangleAlert className="h-7 w-7 shrink-0 text-destructive"/>
                                <div className="flex flex-col gap-1 text-sm">
                                    <span className="text-base font-extrabold text-destructive">
                                        Off by {formatter.format(Math.abs(result.difference))}
                                    </span>
                                    <span>
                                        Pennywise has {shown(result.expected)}. {missingHint(result.difference, owes, bank)}
                                        {result.previousCheckAt && result.transactionsSince > 0
                                            ? `, or one of the ${result.transactionsSince} ${result.transactionsSince === 1 ? "transaction" : "transactions"} since ${dayFormatter.format(new Date(result.previousCheckAt))} is different.`
                                            : "."}
                                    </span>
                                </div>
                            </div>
                            <Button type="button" disabled={check.isPending} onClick={() => check.mutate({save: true})}>
                                Use {bank}&apos;s balance
                            </Button>
                            <Button type="button" variant="outline" disabled={check.isPending}
                                    onClick={() => check.mutate({save: true, adjust: true})}>
                                Use it and add a {formatter.format(Math.abs(result.difference))} adjustment
                            </Button>
                            <p className={cn("text-xs text-muted-foreground")}>
                                Either way the balance becomes {bank}&apos;s. Without an adjustment, the account stays flagged
                                until you find the missing transaction. An adjustment makes it add up without counting as spending.
                            </p>
                        </div>
                    )}
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default BalanceCheckSheet;
