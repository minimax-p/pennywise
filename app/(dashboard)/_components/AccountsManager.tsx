'use client';

import React, {ReactNode, useState} from 'react';
import Link from "next/link";
import {useMutation} from "@tanstack/react-query";
import {toast} from "sonner";
import {ChevronRight, Loader2, Pencil, Plus, Trash2} from "lucide-react";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Badge} from "@/components/ui/badge";
import {Switch} from "@/components/ui/switch";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from "@/components/ui/dialog";
import {CreateAccount, DeleteAccount, EditAccount} from "@/app/(dashboard)/_actions/accounts";
import {ACCOUNT_TYPE_LABELS, accountIcon, AccountRow, useAccounts} from "@/app/(dashboard)/_components/AccountPicker";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";
import {ACCOUNT_TYPES, AccountType} from "@/lib/types";
import {BalanceDateFromDay, GetFormatterForCurrency, ToDayString} from "@/lib/helpers";
import {formatBalance} from "@/lib/money";
import {cn} from "@/lib/utils";

const INSTITUTIONS = ["Chase", "Discover", "Capital One", "Venmo", "Apple", "American Express", "Bank of America", "Wells Fargo"];

const TYPE_HINTS: Record<AccountType, string> = {
    checking: "Debit card, paychecks",
    savings: "High-yield, emergency fund",
    cd: "Locked until it matures",
    credit: "Shows what you owe",
    cash: "Bills and coins in your wallet",
    wallet: "Venmo, PayPal or Cash App balance",
};

function AccountsManager({currency}: { currency: string }) {
    const accountsQuery = useAccounts();
    const formatter = GetFormatterForCurrency(currency);
    const accounts = Array.isArray(accountsQuery.data) ? accountsQuery.data : [];

    return (
        <SkeletonWrapper isLoading={accountsQuery.isLoading}>
            <div className="flex flex-col gap-2">
                {accounts.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        Add each bank account, card, CD and cash you use, for example Chase checking, Discover card and
                        Capital One savings.
                    </p>
                )}
                {accounts.map((account) => (
                    <AccountRowView key={account.id} account={account} formatter={formatter}/>
                ))}
                <div className="pt-2">
                    <AccountFormDialog trigger={<Button><Plus/>Add account</Button>}/>
                </div>
            </div>
        </SkeletonWrapper>
    );
}

function AccountRowView({account, formatter}: { account: AccountRow, formatter: Intl.NumberFormat }) {
    const Icon = accountIcon(account.type);
    return (
        <div className="flex items-center gap-3 rounded-2xl border-2 p-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary"><Icon className="h-5 w-5"/></span>
            <Link href={`/accounts/${account.id}`} className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 font-bold">
                    <span className="truncate">{account.name}</span>
                    {account.archived && <Badge variant="outline">Archived</Badge>}
                </span>
                <span className="truncate text-xs font-semibold text-muted-foreground">
                    {[account.institution, ACCOUNT_TYPE_LABELS[account.type as AccountType]].filter(Boolean).join(' · ')}
                    {account.walletCardName && ` · Apple Pay: ${account.walletCardName}`}
                </span>
            </Link>
            <span className="hidden font-display font-semibold money sm:inline">{formatBalance(account, formatter)}</span>
            <AccountFormDialog account={account} trigger={
                <Button variant="ghost" size="icon" aria-label={`Edit ${account.name}`}><Pencil/></Button>
            }/>
            {account.transactionCount === 0
                ? <DeleteAccountButton account={account}/>
                : <Link href={`/accounts/${account.id}`} aria-label={`Open ${account.name}`} className="text-muted-foreground"><ChevronRight/></Link>}
        </div>
    );
}

export function AccountFormDialog({account, trigger}: { account?: AccountRow, trigger: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(account?.name ?? "");
    const [type, setType] = useState<AccountType>((account?.type as AccountType) ?? "checking");
    const [institution, setInstitution] = useState(account?.institution ?? "");
    const [walletCardName, setWalletCardName] = useState(account?.walletCardName ?? "");
    const [archived, setArchived] = useState(account?.archived ?? false);
    const [apy, setApy] = useState(account?.apy != null ? String(account.apy) : "");
    const [maturesOn, setMaturesOn] = useState(account?.maturesOn ? new Date(account.maturesOn).toISOString().slice(0, 10) : "");
    const [balance, setBalance] = useState("");
    const [day, setDay] = useState(ToDayString(new Date()));
    const invalidate = useInvalidateMoney();

    const mutation = useMutation({
        mutationFn: async () => {
            const cd = {
                apy: apy.trim() === "" ? null : Number(apy),
                maturesOn: maturesOn ? new Date(`${maturesOn}T00:00:00Z`) : null,
            };
            if (account) {
                return EditAccount({id: account.id, name, type, institution, walletCardName, archived, ...cd});
            }
            const value = Number(balance) || 0;
            return CreateAccount({
                name, type, institution, walletCardName, ...cd,
                balance: type === 'credit' ? -Math.abs(value) : value,
                balanceDate: BalanceDateFromDay(day),
            });
        },
        onSuccess: async (response) => {
            if (!response.ok) {
                toast.error(response.error);
                return;
            }
            toast.success(account ? "Saved" : `Added ${name} 🎉`);
            await invalidate();
            setOpen(false);
            if (!account) {
                setName("");
                setBalance("");
            }
        },
        onError: () => toast.error("Could not save the account"),
    });

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>{account ? `Edit ${account.name}` : "Add an account"}</DialogTitle>
                    {!account && <DialogDescription>Start from what your bank shows today. Pennywise keeps it up to date from there.</DialogDescription>}
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={(e) => {
                    e.preventDefault();
                    mutation.mutate();
                }}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Type">
                        {ACCOUNT_TYPES.map((t) => {
                            const Icon = accountIcon(t);
                            return (
                                <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}
                                        className={cn("flex flex-col items-start gap-1 rounded-2xl border-2 p-3 text-left transition-colors",
                                            type === t ? "border-primary bg-primary-soft" : "border-border bg-card")}>
                                    <Icon className="h-5 w-5"/>
                                    <span className="text-sm font-extrabold">{ACCOUNT_TYPE_LABELS[t]}</span>
                                    <span className="text-[11px] font-semibold leading-tight text-muted-foreground">{TYPE_HINTS[t]}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="account-name">Name</Label>
                            <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)}
                                   placeholder="e.g. Chase checking" maxLength={40} required/>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="account-institution">Bank</Label>
                            <Input id="account-institution" list="institutions" value={institution}
                                   onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Chase" maxLength={60}/>
                            <datalist id="institutions">
                                {INSTITUTIONS.map((i) => <option key={i} value={i}/>)}
                            </datalist>
                        </div>
                    </div>
                    {!account && (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="account-balance">{type === 'credit' ? "You owe" : "Balance"}</Label>
                                <Input id="account-balance" inputMode="decimal" placeholder="0.00" value={balance}
                                       onChange={(e) => setBalance(e.target.value.replace(/[^0-9.-]/g, ""))}/>
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="account-balance-day">As of</Label>
                                <Input id="account-balance-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} required/>
                            </div>
                        </div>
                    )}
                    {type === "cd" && (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="account-apy">Rate (APY %)</Label>
                                <Input id="account-apy" inputMode="decimal" placeholder="e.g. 4.10" value={apy}
                                       onChange={(e) => setApy(e.target.value.replace(/[^0-9.]/g, ""))}/>
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="account-matures">Matures on</Label>
                                <Input id="account-matures" type="date" value={maturesOn} onChange={(e) => setMaturesOn(e.target.value)}/>
                            </div>
                        </div>
                    )}
                    {(type === "credit" || type === "checking") && (
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="account-wallet">Apple Wallet card name (optional)</Label>
                            <Input id="account-wallet" value={walletCardName} onChange={(e) => setWalletCardName(e.target.value)}
                                   placeholder="e.g. Discover it" maxLength={80}/>
                            <p className="text-xs text-muted-foreground">
                                The card&apos;s name in Wallet, so Apple Pay purchases land in this account.
                            </p>
                        </div>
                    )}
                    {account && (
                        <label className="flex items-center justify-between gap-2 rounded-2xl bg-secondary p-3 text-sm font-semibold">
                            <span>Archived <span className="font-normal text-muted-foreground">(hidden from Home and forms)</span></span>
                            <Switch checked={archived} onCheckedChange={setArchived}/>
                        </label>
                    )}
                    <DialogFooter>
                        <Button type="submit" size="lg" disabled={mutation.isPending || !name.trim()}>
                            {mutation.isPending ? <Loader2 className="animate-spin"/> : account ? "Save" : "Add account"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function DeleteAccountButton({account}: { account: AccountRow }) {
    const [confirm, setConfirm] = useState(false);
    const invalidate = useInvalidateMoney();
    const mutation = useMutation({
        mutationFn: () => DeleteAccount({id: account.id}),
        onSuccess: async (response) => {
            if (!response.ok) {
                toast.error(response.error);
                return;
            }
            toast.success(`Deleted ${account.name}`);
            await invalidate();
        },
        onError: () => toast.error("Could not delete the account"),
    });

    return (
        <Button variant={confirm ? "destructive" : "ghost"} size={confirm ? "sm" : "icon"} aria-label={`Delete ${account.name}`}
                onClick={() => confirm ? mutation.mutate() : setConfirm(true)} onBlur={() => setConfirm(false)}>
            <Trash2/>{confirm && "Delete?"}
        </Button>
    );
}

export default AccountsManager;
