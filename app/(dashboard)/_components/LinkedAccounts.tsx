'use client';

import React, {useState} from 'react';
import {useMutation, useQuery} from "@tanstack/react-query";
import {formatDistanceToNow} from "date-fns";
import {toast} from "sonner";
import {AlertTriangle, Landmark, Loader2, Plus, RefreshCw, Unlink} from "lucide-react";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import PlaidLink, {showSyncResults, TOAST_ID, useInvalidateAfterSync} from "@/components/PlaidLink";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Checkbox} from "@/components/ui/checkbox";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import {SyncPlaidItems, UnlinkPlaidItem} from "@/app/(dashboard)/_actions/plaid";
import type {GetPlaidItemsResponseType} from "@/app/api/plaid/items/route";

type PlaidItemRow = GetPlaidItemsResponseType['items'][number];

function useSyncMutation() {
    const invalidate = useInvalidateAfterSync();
    return useMutation({
        mutationFn: SyncPlaidItems,
        onMutate: () => {
            toast.loading('Syncing transactions...', {id: TOAST_ID});
        },
        onSuccess: (response) => {
            if (!response.ok) toast.error(response.error, {id: TOAST_ID});
            else showSyncResults(response.data);
        },
        onError: () => {
            toast.error('Sync failed', {id: TOAST_ID});
        },
        onSettled: invalidate,
    });
}

// Renders nothing unless Plaid credentials are configured on the server
function LinkedAccounts() {
    const itemsQuery = useQuery<GetPlaidItemsResponseType>({
        queryKey: ['plaid-items'],
        queryFn: () => fetch('/api/plaid/items').then((res) => res.json()),
    });
    if (!itemsQuery.data?.enabled) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Link Your Bank Accounts</CardTitle>
                <CardDescription>Connect your accounts securely with Plaid</CardDescription>
            </CardHeader>
            <CardContent>
                <LinkedAccountList items={itemsQuery.data.items}/>
            </CardContent>
        </Card>
    );
}

function LinkedAccountList({items}: { items: PlaidItemRow[] }) {
    const syncAll = useSyncMutation();

    return (
        <div className="flex flex-col gap-4">
            {items.length === 0 && (
                <p className="text-sm text-muted-foreground">
                    No bank accounts linked yet. Linked accounts import their transactions automatically when you sync.
                </p>
            )}
            {items.map((item) => <LinkedAccountRow key={item.id} item={item}/>)}
            <div className="flex flex-wrap gap-2">
                <PlaidLink className="gap-2">
                    <Plus className="h-4 w-4"/>
                    Link a bank account
                </PlaidLink>
                {items.length > 1 && (
                    <Button variant="outline" className="gap-2" disabled={syncAll.isPending}
                            onClick={() => syncAll.mutate(undefined)}>
                        <RefreshCw className={syncAll.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"}/>
                        Sync all
                    </Button>
                )}
            </div>
        </div>
    );
}

function LinkedAccountRow({item}: { item: PlaidItemRow }) {
    const sync = useSyncMutation();
    const needsReconnect = item.error === 'ITEM_LOGIN_REQUIRED';

    return (
        <div className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
                <Landmark className="h-10 w-10 rounded-2xl bg-primary-soft p-2 text-primary"/>
                <div>
                    <p className="font-semibold">{item.institutionName ?? 'Bank account'}</p>
                    <p className="text-sm text-muted-foreground">
                        {item._count.transactions} imported transactions
                        {' · '}
                        {item.lastSyncedAt
                            ? `synced ${formatDistanceToNow(new Date(item.lastSyncedAt), {addSuffix: true})}`
                            : 'never synced'}
                    </p>
                    {item.error && (
                        <Badge variant="destructive" className="mt-1 gap-1">
                            <AlertTriangle className="h-3 w-3"/>
                            {needsReconnect ? 'Login expired, reconnect to keep syncing' : `Last sync failed: ${item.error}`}
                        </Badge>
                    )}
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                {needsReconnect ? (
                    <PlaidLink itemId={item.id} variant="secondary" className="gap-2">
                        <RefreshCw className="h-4 w-4"/>
                        Reconnect
                    </PlaidLink>
                ) : (
                    <Button variant="secondary" className="gap-2" disabled={sync.isPending}
                            onClick={() => sync.mutate(item.id)}>
                        <RefreshCw className={sync.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"}/>
                        Sync
                    </Button>
                )}
                <UnlinkDialog item={item}/>
            </div>
        </div>
    );
}

function UnlinkDialog({item}: { item: PlaidItemRow }) {
    const [deleteTransactions, setDeleteTransactions] = useState(false);
    const invalidate = useInvalidateAfterSync();
    const toastId = `unlink-${item.id}`;
    const name = item.institutionName ?? 'this bank account';

    const unlink = useMutation({
        mutationFn: UnlinkPlaidItem,
        onMutate: () => {
            toast.loading(`Unlinking ${name}...`, {id: toastId});
        },
        onSuccess: (response) => {
            if (!response.ok) {
                toast.error(response.error, {id: toastId});
                return;
            }
            const removed = response.data.deletedTransactions;
            toast.success(removed > 0 ? `Unlinked ${name} and deleted ${removed} transactions` : `Unlinked ${name}`, {id: toastId});
        },
        onError: () => {
            toast.error(`Failed to unlink ${name}`, {id: toastId});
        },
        onSettled: invalidate,
    });

    return (
        <AlertDialog onOpenChange={() => setDeleteTransactions(false)}>
            <AlertDialogTrigger asChild>
                <Button variant="secondary" className="gap-2 hover:bg-red-400 hover:text-white" disabled={unlink.isPending}>
                    {unlink.isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Unlink className="h-4 w-4"/>}
                    Unlink
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Unlink {name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Pennywise will stop importing transactions from this bank and Plaid will revoke its access.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {item._count.transactions > 0 && (
                    <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={deleteTransactions}
                                  onCheckedChange={(checked) => setDeleteTransactions(checked === true)}/>
                        Also delete the {item._count.transactions} transactions imported from this bank
                    </label>
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => unlink.mutate({id: item.id, deleteTransactions})}>
                        Unlink
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export default LinkedAccounts;
