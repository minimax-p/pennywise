'use client';

import React, {ReactNode, useCallback, useEffect, useState} from 'react';
import {usePlaidLink} from "react-plaid-link";
import {useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {Loader2} from "lucide-react";
import {Button, ButtonProps} from "@/components/ui/button";
import {CreatePlaidLinkToken, ExchangePlaidPublicToken, SyncPlaidItems} from "@/app/(dashboard)/_actions/plaid";
import type {PlaidSyncResult} from "@/lib/plaidSync";

interface Props extends Omit<ButtonProps, 'onClick'> {
    children: ReactNode;
    // Reconnects this bank connection instead of linking a new one
    itemId?: string;
}

export const TOAST_ID = 'plaid-link';

export function describeSyncResult(result: PlaidSyncResult) {
    const name = result.institutionName ?? 'Bank account';
    if (result.error === 'ITEM_LOGIN_REQUIRED') return `${name}: please reconnect to keep syncing`;
    if (result.error) return `${name}: sync failed (${result.error})`;
    if (result.notReady) return `${name}: the bank is still preparing your transactions, try syncing again in a minute`;
    return `${name}: ${result.added} new, ${result.modified} updated, ${result.removed} removed`;
}

export function showSyncResults(results: PlaidSyncResult[]) {
    const message = (
        <div className="flex flex-col">
            {results.map((r) => <span key={r.itemId}>{describeSyncResult(r)}</span>)}
        </div>
    );
    if (results.some((r) => r.error)) toast.error(message, {id: TOAST_ID});
    else toast.success(message, {id: TOAST_ID});
}

export function useInvalidateAfterSync() {
    const queryClient = useQueryClient();
    return useCallback(() => Promise.all([
        queryClient.invalidateQueries({queryKey: ['plaid-items']}),
        queryClient.invalidateQueries({queryKey: ['overview']}),
        queryClient.invalidateQueries({queryKey: ['transactions']}),
        queryClient.invalidateQueries({queryKey: ['categories']}),
    ]), [queryClient]);
}

function PlaidLink({children, itemId, disabled, ...buttonProps}: Props) {
    const [linkToken, setLinkToken] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const invalidate = useInvalidateAfterSync();

    const onSuccess = useCallback(async (publicToken: string) => {
        setLinkToken(null);
        toast.loading(itemId ? 'Syncing transactions...' : 'Linking account and importing transactions...', {id: TOAST_ID});
        try {
            // Update mode keeps the same access token, so only a sync is needed
            const response = itemId ? await SyncPlaidItems(itemId) : await ExchangePlaidPublicToken(publicToken);
            if (!response.ok) {
                toast.error(response.error, {id: TOAST_ID});
                return;
            }
            const results = Array.isArray(response.data) ? response.data : [response.data];
            showSyncResults(results);
        } catch {
            toast.error('Something went wrong while linking your account', {id: TOAST_ID});
        } finally {
            setBusy(false);
            await invalidate();
        }
    }, [itemId, invalidate]);

    const onExit = useCallback(() => {
        setLinkToken(null);
        setBusy(false);
    }, []);

    const {open, ready} = usePlaidLink({token: linkToken, onSuccess, onExit});

    useEffect(() => {
        if (linkToken && ready) open();
    }, [linkToken, ready, open]);

    const start = async () => {
        setBusy(true);
        try {
            const response = await CreatePlaidLinkToken(itemId);
            if (!response.ok) {
                toast.error(response.error, {id: TOAST_ID});
                setBusy(false);
                return;
            }
            setLinkToken(response.data.linkToken);
        } catch {
            toast.error('Could not start Plaid Link', {id: TOAST_ID});
            setBusy(false);
        }
    };

    return (
        <Button {...buttonProps} disabled={disabled || busy} onClick={start}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin"/> : null}
            {children}
        </Button>
    );
}

export default PlaidLink;
