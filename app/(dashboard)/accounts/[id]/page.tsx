'use client';

import React, {Suspense, useEffect, useState} from 'react';
import Link from "next/link";
import {useParams, useSearchParams} from "next/navigation";
import {useMutation, useQuery} from "@tanstack/react-query";
import {toast} from "sonner";
import {AlertTriangle, ArrowLeft, CheckCircle2, FileUp, Pencil, Scale, Trash2} from "lucide-react";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Card} from "@/components/ui/card";
import {Button, buttonVariants} from "@/components/ui/button";
import {accountIcon, ACCOUNT_TYPE_LABELS} from "@/app/(dashboard)/_components/AccountPicker";
import {AccountFormDialog} from "@/app/(dashboard)/_components/AccountsManager";
import BalanceCheckSheet from "@/app/(dashboard)/_components/BalanceCheckSheet";
import {DayGroupedList} from "@/app/(dashboard)/_components/TransactionList";
import {useCurrencyFormatter} from "@/app/(dashboard)/_components/TransactionSheet";
import {DeleteBalanceCheck} from "@/app/(dashboard)/_actions/accounts";
import type {AccountPageData} from "@/lib/accountPage";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";
import {AccountType} from "@/lib/types";
import {dayFormatter, formatBalance, fullDayFormatter} from "@/lib/money";
import {cn} from "@/lib/utils";

// How far back the list goes; "Show older" steps through these, 0 being everything
const DAY_STEPS = [90, 365, 0];
const DAY_MS = 24 * 60 * 60 * 1000;

function AccountView() {
    const {id} = useParams<{ id: string }>();
    const params = useSearchParams();
    const [step, setStep] = useState(0);
    const [checking, setChecking] = useState(false);
    const formatter = useCurrencyFormatter();

    const query = useQuery<AccountPageData>({
        queryKey: ['account', id, DAY_STEPS[step]],
        queryFn: async () => {
            const res = await fetch(`/api/accounts/${id}?days=${DAY_STEPS[step]}`);
            if (!res.ok) throw new Error("not found");
            return res.json();
        },
    });

    // Home's "Check" nudge opens the check right away
    useEffect(() => {
        if (params.get("check") === "1") setChecking(true);
    }, [params]);

    if (query.isError) {
        return (
            <div className="container py-10 text-center">
                <p className="font-bold">That account doesn&apos;t exist.</p>
                <Link href="/accounts" className="text-primary underline">See all accounts</Link>
            </div>
        );
    }

    const data = query.data;
    const account = data?.account;
    const Icon = accountIcon(account?.type ?? "checking");
    // Where each stretch that doesn't add up ends, by day
    const mismatchEnds = new Map((data?.mismatches ?? []).map((m) => [m.to.slice(0, 10), m]));

    return (
        <div className="container flex flex-col gap-4 py-4 md:py-8">
            <Link href="/accounts" className="flex items-center gap-1 self-start text-sm font-bold text-muted-foreground">
                <ArrowLeft className="h-4 w-4"/>Accounts
            </Link>
            <SkeletonWrapper isLoading={query.isLoading}>
                <Card className="flex flex-col gap-4 p-5 md:p-6">
                    <div className="flex items-center gap-3">
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-secondary"><Icon className="h-6 w-6"/></span>
                        <div className="min-w-0 flex-1">
                            <h1 className="truncate font-display text-2xl font-bold">{account?.name ?? "Account"}</h1>
                            <p className="text-sm font-semibold text-muted-foreground">
                                {[account?.institution, account ? ACCOUNT_TYPE_LABELS[account.type as AccountType] : null].filter(Boolean).join(" · ")}
                            </p>
                        </div>
                        {account && (
                            <AccountFormDialog account={{...account, transactionCount: data.rows.length}} trigger={
                                <Button variant="ghost" size="icon" aria-label="Edit account"><Pencil/></Button>
                            }/>
                        )}
                    </div>
                    <p className={cn("font-display text-5xl font-bold tracking-tight money", account?.type === "credit" && (account?.balance ?? 0) < 0 && "text-spend-ink")}>
                        {account ? formatBalance(account, formatter) : formatter.format(0)}
                    </p>
                    {account && <CheckStatus account={account} formatter={formatter}/>}
                    {account?.type === "cd" && <CdDetails account={account} formatter={formatter}/>}
                    <div className="grid grid-cols-2 gap-3">
                        <Button onClick={() => setChecking(true)}><Scale/>Check balance</Button>
                        <Link href={`/import?account=${id}`} className={buttonVariants({variant: "outline"})}><FileUp/>Import</Link>
                    </div>
                </Card>
            </SkeletonWrapper>

            {data && data.mismatches.length > 0 && (
                <Card className="flex flex-col gap-2 border-destructive/30 p-5">
                    <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-destructive">
                        <AlertTriangle className="h-5 w-5"/>Where it doesn&apos;t add up
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Between these balance checks, the transactions don&apos;t add up to the bank&apos;s change in balance.
                        Look for a missing, doubled or different transaction in those days.
                    </p>
                    {data.mismatches.map((m) => (
                        <Link key={m.to} href={`/transactions?account=${id}&from=${m.from.slice(0, 10)}&to=${m.to.slice(0, 10)}`}
                              className="flex items-center justify-between gap-3 rounded-2xl bg-destructive/10 px-3 py-2 text-sm font-bold">
                            <span>{dayFormatter.format(new Date(m.from))} → {dayFormatter.format(new Date(m.to))}</span>
                            <span className="money">{m.difference > 0 ? "+" : "−"}{formatter.format(Math.abs(m.difference))}</span>
                        </Link>
                    ))}
                </Card>
            )}

            <SkeletonWrapper isLoading={query.isLoading}>
                <Card className="p-2 md:p-3">
                    <div className="flex items-baseline justify-between px-2 pb-1 pt-2">
                        <h2 className="font-display text-xl font-semibold">Activity</h2>
                        <span className="text-xs font-bold text-muted-foreground">Balance after each line</span>
                    </div>
                    <DayGroupedList rows={data?.rows ?? []}
                                    empty={<p className="p-8 text-center font-semibold text-muted-foreground">No transactions yet. Import a statement or add one with +.</p>}
                                    renderAfterDay={(day) => {
                                        const m = mismatchEnds.get(day);
                                        return m ? (
                                            <p className="mx-2 my-1 rounded-2xl bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive">
                                                The bank&apos;s balance at the end of this day differs by {formatter.format(Math.abs(m.difference))} from
                                                what the transactions since {dayFormatter.format(new Date(m.from))} add up to.
                                            </p>
                                        ) : null;
                                    }}/>
                    {data && data.olderCount > 0 && step < DAY_STEPS.length - 1 && (
                        <div className="p-3">
                            <Button variant="outline" className="w-full" onClick={() => setStep((s) => s + 1)}>
                                Show older ({data.olderCount} more)
                            </Button>
                        </div>
                    )}
                </Card>
            </SkeletonWrapper>

            {data && (data.checks.length > 0 || data.statements) && <Checks data={data} formatter={formatter}/>}

            {account && <BalanceCheckSheet account={account} open={checking} onOpenChange={setChecking}/>}
        </div>
    );
}

function CheckStatus({account, formatter}: { account: AccountPageData["account"], formatter: Intl.NumberFormat }) {
    const {check} = account;
    if (check.mismatch) {
        return (
            <p className="flex items-center gap-2 self-start rounded-full bg-destructive/10 px-3 py-1.5 text-sm font-bold text-destructive">
                <AlertTriangle className="h-4 w-4"/>Off by {formatter.format(Math.abs(check.mismatch.difference))} since {dayFormatter.format(new Date(check.mismatch.from))}
            </p>
        );
    }
    if (!check.lastCheckedAt) {
        return <p className="self-start rounded-full bg-secondary px-3 py-1.5 text-sm font-bold">Not checked with the bank yet</p>;
    }
    const fresh = check.daysSinceCheck !== null && check.daysSinceCheck < 14;
    return (
        <p className={cn("flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-sm font-bold",
            fresh ? "bg-primary-soft text-foreground" : "bg-secondary")}>
            {fresh && <CheckCircle2 className="h-4 w-4 text-primary"/>}
            {check.lastCheckSource === "statement" ? "Matched the statement" : "Checked"} on {dayFormatter.format(new Date(check.lastCheckedAt))}
        </p>
    );
}

function CdDetails({account, formatter}: { account: AccountPageData["account"], formatter: Intl.NumberFormat }) {
    if (account.apy == null && !account.maturesOn) return null;
    const matures = account.maturesOn ? new Date(account.maturesOn) : null;
    const daysLeft = matures ? Math.max(0, Math.ceil((matures.getTime() - Date.now()) / DAY_MS)) : null;
    // A rough figure: the yearly rate for the time left, without compounding
    const interest = account.apy != null && daysLeft !== null ? account.balance * account.apy / 100 * daysLeft / 365 : null;
    return (
        <div className="grid grid-cols-2 gap-3 text-sm">
            {account.apy != null && (
                <div className="rounded-2xl bg-secondary p-3">
                    <p className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Rate</p>
                    <p className="font-display text-xl font-semibold">{account.apy}% APY</p>
                </div>
            )}
            {matures && (
                <div className="rounded-2xl bg-secondary p-3">
                    <p className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Matures</p>
                    <p className="font-display text-xl font-semibold">{fullDayFormatter.format(matures)}</p>
                    <p className="text-xs font-semibold text-muted-foreground">
                        {daysLeft ? `${daysLeft} days left` : "Matured"}
                        {interest !== null && interest > 0 && ` · about ${formatter.format(interest)} more interest`}
                    </p>
                </div>
            )}
        </div>
    );
}

function Checks({data, formatter}: { data: AccountPageData, formatter: Intl.NumberFormat }) {
    const invalidate = useInvalidateMoney();
    const remove = useMutation({
        mutationFn: (id: string) => DeleteBalanceCheck({id}),
        onSuccess: async (response) => {
            if (!response.ok) toast.error(response.error);
            else toast.success("Removed the check");
            await invalidate();
        },
    });
    const owes = data.account.type === "credit";
    return (
        <Card className="flex flex-col gap-2 p-5">
            <h2 className="font-display text-xl font-semibold">Balance checks</h2>
            {data.statements && (
                <p className="text-sm text-muted-foreground">
                    Statements gave end-of-day balances from {fullDayFormatter.format(new Date(data.statements.from))} to {fullDayFormatter.format(new Date(data.statements.to))}.
                </p>
            )}
            {data.checks.map((check) => (
                <div key={check.id} className="flex items-center gap-3 rounded-2xl bg-secondary px-3 py-2">
                    <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-bold">{fullDayFormatter.format(new Date(check.date))}</span>
                        <span className={cn("text-xs font-bold", Math.abs(check.difference) < 0.005 ? "text-primary" : "text-destructive")}>
                            {Math.abs(check.difference) < 0.005 ? "Added up ✓" : `Off by ${formatter.format(Math.abs(check.difference))}`}
                        </span>
                    </div>
                    <span className="font-display font-semibold money">{formatter.format(owes ? -check.balance : check.balance)}{owes && " owed"}</span>
                    <Button variant="ghost" size="icon" aria-label="Remove this check" disabled={remove.isPending}
                            onClick={() => remove.mutate(check.id)}><Trash2/></Button>
                </div>
            ))}
        </Card>
    );
}

function AccountPage() {
    return (
        <Suspense>
            <AccountView/>
        </Suspense>
    );
}

export default AccountPage;
