'use client';

import React, {ReactNode, useState} from 'react';
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {Loader2, Pencil, Plus, Scale, Trash2, Wallet} from "lucide-react";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Badge} from "@/components/ui/badge";
import {Switch} from "@/components/ui/switch";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import {CreateAccount, DeleteAccount, EditAccount, SetAccountBalance} from "@/app/(dashboard)/_actions/accounts";
import {ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS, AccountRow, useAccounts} from "@/app/(dashboard)/_components/AccountPicker";
import {ACCOUNT_TYPES, AccountType} from "@/lib/types";
import {BalanceDateFromDay, GetFormatterForCurrency, ToDayString} from "@/lib/helpers";

const INSTITUTIONS = ["Chase", "Discover", "Capital One", "Venmo", "Apple", "American Express", "Bank of America", "Wells Fargo"];

function useInvalidateAccounts() {
    const queryClient = useQueryClient();
    return () => Promise.all([
        queryClient.invalidateQueries({queryKey: ['accounts']}),
        queryClient.invalidateQueries({queryKey: ['transactions']}),
    ]);
}

// Credit card balances are stored negative (money owed) but entered and shown as an amount owed
export function formatBalance(account: { type: string, balance: number }, formatter: Intl.NumberFormat) {
    if (account.type === 'credit') {
        return account.balance <= 0 ? `${formatter.format(-account.balance)} owed` : `${formatter.format(account.balance)} credit`;
    }
    return formatter.format(account.balance);
}

function AccountsManager({currency}: { currency: string }) {
    const accountsQuery = useAccounts();
    const formatter = GetFormatterForCurrency(currency);
    const accounts = Array.isArray(accountsQuery.data) ? accountsQuery.data : [];

    return (
        <SkeletonWrapper isLoading={accountsQuery.isLoading}>
            <div className="flex flex-col gap-3">
                {accounts.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        Add each bank account and card you use, for example Chase checking, Discover card and
                        Capital One savings. Transactions and transfers are then tracked per account.
                    </p>
                )}
                {accounts.map((account) => (
                    <AccountRowView key={account.id} account={account} formatter={formatter}/>
                ))}
                <div>
                    <AccountFormDialog trigger={
                        <Button className="gap-2 font-mono"><Plus className="h-4 w-4"/>Add account</Button>
                    }/>
                </div>
            </div>
        </SkeletonWrapper>
    );
}

function AccountRowView({account, formatter}: { account: AccountRow, formatter: Intl.NumberFormat }) {
    const Icon = ACCOUNT_TYPE_ICONS[account.type as AccountType] ?? Wallet;
    return (
        <div className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
                <Icon className="h-10 w-10 rounded-lg bg-sky-400/10 p-2 text-sky-500"/>
                <div>
                    <p className="flex items-center gap-2 font-semibold">
                        {account.name}
                        {account.archived && <Badge variant="outline">Archived</Badge>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                        {[account.institution, ACCOUNT_TYPE_LABELS[account.type as AccountType]].filter(Boolean).join(' · ')}
                        {account.walletCardName && ` · Apple Pay: ${account.walletCardName}`}
                    </p>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <span className={account.type === 'credit' && account.balance < 0 ? "mr-2 font-mono text-amber-500" : "mr-2 font-mono"}>
                    {formatBalance(account, formatter)}
                </span>
                <BalanceDialog account={account}/>
                <AccountFormDialog account={account} trigger={
                    <Button variant="secondary" size="icon" aria-label={`Edit ${account.name}`}><Pencil className="h-4 w-4"/></Button>
                }/>
                {account.transactionCount === 0 && <DeleteAccountDialog account={account}/>}
            </div>
        </div>
    );
}

function AccountFormDialog({account, trigger}: { account?: AccountRow, trigger: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(account?.name ?? "");
    const [type, setType] = useState<AccountType>((account?.type as AccountType) ?? "checking");
    const [institution, setInstitution] = useState(account?.institution ?? "");
    const [walletCardName, setWalletCardName] = useState(account?.walletCardName ?? "");
    const [archived, setArchived] = useState(account?.archived ?? false);
    const [balance, setBalance] = useState("0");
    const [day, setDay] = useState(ToDayString(new Date()));
    const invalidate = useInvalidateAccounts();

    const mutation = useMutation({
        mutationFn: async () => {
            if (account) {
                return EditAccount({id: account.id, name, type, institution, walletCardName, archived});
            }
            const value = Number(balance) || 0;
            return CreateAccount({
                name, type, institution, walletCardName,
                balance: type === 'credit' ? -value : value,
                balanceDate: BalanceDateFromDay(day),
            });
        },
        onSuccess: async () => {
            toast.success(account ? "Account updated" : `Added ${name}`, {id: 'account-form'});
            await invalidate();
            setOpen(false);
            if (!account) {
                setName("");
                setBalance("0");
            }
        },
        onError: (error) => {
            toast.error(error.message.includes("already exists") ? error.message : "Could not save the account", {id: 'account-form'});
        },
    });

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                    <DialogTitle>{account ? `Edit ${account.name}` : "Add account"}</DialogTitle>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={(e) => {
                    e.preventDefault();
                    mutation.mutate();
                }}>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="account-name">Name</Label>
                        <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)}
                               placeholder="e.g. Chase checking" maxLength={40} required/>
                    </div>
                    <div className="flex gap-4">
                        <div className="flex flex-1 flex-col gap-2">
                            <Label>Type</Label>
                            <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
                                <SelectTrigger><SelectValue/></SelectTrigger>
                                <SelectContent>
                                    {ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-1 flex-col gap-2">
                            <Label htmlFor="account-institution">Bank</Label>
                            <Input id="account-institution" list="institutions" value={institution}
                                   onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Chase" maxLength={60}/>
                            <datalist id="institutions">
                                {INSTITUTIONS.map((i) => <option key={i} value={i}/>)}
                            </datalist>
                        </div>
                    </div>
                    {!account && (
                        <div className="flex gap-4">
                            <div className="flex flex-1 flex-col gap-2">
                                <Label htmlFor="account-balance">{type === 'credit' ? "Amount owed" : "Current balance"}</Label>
                                <Input id="account-balance" type="number" step="0.01" inputMode="decimal" value={balance}
                                       onChange={(e) => setBalance(e.target.value)}/>
                            </div>
                            <div className="flex flex-1 flex-col gap-2">
                                <Label htmlFor="account-balance-day">As of</Label>
                                <Input id="account-balance-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} required/>
                            </div>
                        </div>
                    )}
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="account-wallet">Apple Wallet card name (optional)</Label>
                        <Input id="account-wallet" value={walletCardName} onChange={(e) => setWalletCardName(e.target.value)}
                               placeholder="e.g. Discover it" maxLength={80}/>
                        <p className="text-xs text-muted-foreground">
                            The card&apos;s name in the Wallet app. Apple Pay purchases logged by the shortcut are filed under this account.
                        </p>
                    </div>
                    {account && (
                        <label className="flex items-center justify-between gap-2 text-sm">
                            <span>Archived <span className="text-muted-foreground">(hidden when adding transactions)</span></span>
                            <Switch checked={archived} onCheckedChange={setArchived}/>
                        </label>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={mutation.isPending || !name.trim()}>
                            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : account ? "Save" : "Add account"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function BalanceDialog({account}: { account: AccountRow }) {
    const [open, setOpen] = useState(false);
    const isCredit = account.type === 'credit';
    const [balance, setBalance] = useState("");
    const [day, setDay] = useState(ToDayString(new Date()));
    const invalidate = useInvalidateAccounts();

    const mutation = useMutation({
        mutationFn: () => {
            const value = Number(balance) || 0;
            return SetAccountBalance({id: account.id, balance: isCredit ? -value : value, balanceDate: BalanceDateFromDay(day)});
        },
        onSuccess: async () => {
            toast.success(`Updated the balance of ${account.name}`, {id: 'account-balance'});
            await invalidate();
            setOpen(false);
        },
        onError: () => {
            toast.error("Could not update the balance", {id: 'account-balance'});
        },
    });

    return (
        <Dialog open={open} onOpenChange={(next) => {
            if (next) setBalance(String(Math.abs(account.balance)));
            setOpen(next);
        }}>
            <DialogTrigger asChild>
                <Button variant="secondary" className="gap-2"><Scale className="h-4 w-4"/>Balance</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>Update {account.name} balance</DialogTitle>
                    <DialogDescription>
                        Enter the balance your bank shows. Transactions dated after that day are added on top of it.
                    </DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={(e) => {
                    e.preventDefault();
                    mutation.mutate();
                }}>
                    <div className="flex gap-4">
                        <div className="flex flex-1 flex-col gap-2">
                            <Label htmlFor={`balance-${account.id}`}>{isCredit ? "Amount owed" : "Balance"}</Label>
                            <Input id={`balance-${account.id}`} type="number" step="0.01" inputMode="decimal" value={balance}
                                   onChange={(e) => setBalance(e.target.value)} required/>
                        </div>
                        <div className="flex flex-1 flex-col gap-2">
                            <Label htmlFor={`balance-day-${account.id}`}>As of</Label>
                            <Input id={`balance-day-${account.id}`} type="date" value={day} onChange={(e) => setDay(e.target.value)} required/>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={mutation.isPending}>
                            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : "Save"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function DeleteAccountDialog({account}: { account: AccountRow }) {
    const invalidate = useInvalidateAccounts();
    const mutation = useMutation({
        mutationFn: () => DeleteAccount({id: account.id}),
        onSuccess: async () => {
            toast.success(`Deleted ${account.name}`, {id: 'account-delete'});
            await invalidate();
        },
        onError: () => {
            toast.error("Could not delete the account", {id: 'account-delete'});
        },
    });

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="secondary" size="icon" aria-label={`Delete ${account.name}`} className="hover:bg-red-400 hover:text-white">
                    <Trash2 className="h-4 w-4"/>
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete {account.name}?</AlertDialogTitle>
                    <AlertDialogDescription>It has no transactions, so nothing else is affected.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => mutation.mutate()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export default AccountsManager;
