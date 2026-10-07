'use client';

import React, {useCallback, useEffect, useState} from 'react';
import {useQuery} from "@tanstack/react-query";
import {CreditCard, Landmark, LucideIcon, PiggyBank, Wallet} from "lucide-react";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {AccountType} from "@/lib/types";
import type {GetAccountsResponseType} from "@/app/api/accounts/route";

export type AccountRow = GetAccountsResponseType[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
    checking: "Checking",
    savings: "Savings",
    credit: "Credit card",
    cash: "Cash or wallet",
};

export const ACCOUNT_TYPE_ICONS: Record<AccountType, LucideIcon> = {
    checking: Landmark,
    savings: PiggyBank,
    credit: CreditCard,
    cash: Wallet,
};

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
                    const Icon = ACCOUNT_TYPE_ICONS[account.type as AccountType] ?? Wallet;
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

export default AccountPicker;
