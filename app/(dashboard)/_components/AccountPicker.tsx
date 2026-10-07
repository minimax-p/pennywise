'use client';

import React, {useCallback, useEffect, useState} from 'react';
import {useQuery} from "@tanstack/react-query";
import {CreditCard, Landmark, LucideIcon, PiggyBank, Vault, Wallet} from "lucide-react";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {AccountType} from "@/lib/types";
import type {GetAccountsResponseType} from "@/app/api/accounts/route";
import {cn} from "@/lib/utils";

export type AccountRow = GetAccountsResponseType[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
    checking: "Checking",
    savings: "Savings",
    cd: "CD",
    credit: "Credit card",
    cash: "Cash or wallet",
};

export const ACCOUNT_TYPE_ICONS: Record<AccountType, LucideIcon> = {
    checking: Landmark,
    savings: PiggyBank,
    cd: Vault,
    credit: CreditCard,
    cash: Wallet,
};

export function accountIcon(type: string): LucideIcon {
    return ACCOUNT_TYPE_ICONS[type as AccountType] ?? Wallet;
}

export function useAccounts() {
    return useQuery<GetAccountsResponseType>({
        queryKey: ['accounts'],
        queryFn: () => fetch('/api/accounts').then((res) => res.json()),
    });
}

// Remembers the account last picked in a form, per browser
export function useRememberedAccount(storageKey: string) {
    const [value, setValue] = useState<string | null>(null);
    // Read after mount so server and client render the same markup
    useEffect(() => {
        try {
            setValue(window.localStorage.getItem(storageKey));
        } catch {
            // Storage can be unavailable, e.g. in private browsing
        }
    }, [storageKey]);
    const remember = useCallback((id: string | null) => {
        setValue(id);
        try {
            if (id) window.localStorage.setItem(storageKey, id);
            else window.localStorage.removeItem(storageKey);
        } catch {
            // Storage can be unavailable, e.g. in private browsing
        }
    }, [storageKey]);
    return [value, remember] as const;
}

const NONE = "__none";

interface Props {
    value: string | null | undefined;
    onChange: (id: string | null) => void;
    allowNone?: boolean;
    placeholder?: string;
    excludeId?: string | null;
}

// A dropdown, for tight spaces like table rows
function AccountPicker({value, onChange, allowNone, placeholder, excludeId}: Props) {
    const {data} = useAccounts();
    const accounts = (Array.isArray(data) ? data : [])
        .filter((a) => (!a.archived || a.id === value) && a.id !== excludeId);
    // Ignore a remembered account that no longer exists
    const known = value && accounts.some((a) => a.id === value) ? value : null;

    return (
        <Select value={known ?? (allowNone ? NONE : "")} onValueChange={(v) => onChange(v === NONE ? null : v)}>
            <SelectTrigger>
                <SelectValue placeholder={placeholder ?? "Select account"}/>
            </SelectTrigger>
            <SelectContent>
                {allowNone && <SelectItem value={NONE}>No account</SelectItem>}
                {accounts.map((account) => {
                    const Icon = accountIcon(account.type);
                    return (
                        <SelectItem key={account.id} value={account.id}>
                            <span className="flex items-center gap-2">
                                <Icon className="h-4 w-4 text-muted-foreground"/>
                                {account.name}
                            </span>
                        </SelectItem>
                    );
                })}
            </SelectContent>
        </Select>
    );
}

// Accounts as big tappable chips, for forms
export function AccountChips({value, onChange, allowNone, excludeId, label}: Props & { label: string }) {
    const {data} = useAccounts();
    const accounts = (Array.isArray(data) ? data : [])
        .filter((a) => (!a.archived || a.id === value) && a.id !== excludeId);
    const known = value && accounts.some((a) => a.id === value) ? value : null;
    const chip = (selected: boolean) => cn(
        "flex items-center gap-1.5 rounded-full border-2 px-3.5 py-2 text-sm font-bold transition-colors",
        selected ? "border-primary bg-primary-soft text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
    );

    return (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
            {accounts.map((account) => {
                const Icon = accountIcon(account.type);
                return (
                    <button key={account.id} type="button" role="radio" aria-checked={known === account.id}
                            className={chip(known === account.id)} onClick={() => onChange(account.id)}>
                        <Icon className="h-4 w-4"/>{account.name}
                    </button>
                );
            })}
            {allowNone && (
                <button type="button" role="radio" aria-checked={!known} className={chip(!known)} onClick={() => onChange(null)}>
                    No account
                </button>
            )}
            {accounts.length === 0 && !allowNone && (
                <p className="text-sm text-muted-foreground">Add your accounts on the Manage page first.</p>
            )}
        </div>
    );
}

export default AccountPicker;
