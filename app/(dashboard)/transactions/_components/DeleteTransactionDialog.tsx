'use client';

import React, {ReactNode} from 'react';
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {AlertTriangle} from "lucide-react";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import {DeleteTransaction} from "@/app/(dashboard)/_actions/transactions";
import type {GetTransactionsHistoryResponseType} from "@/app/api/transactions/route";

interface Props {
    trigger: ReactNode;
    transaction: GetTransactionsHistoryResponseType[number];
}

function DeleteTransactionDialog({trigger, transaction}: Props) {
    const toastId = `delete-transaction-${transaction.id}`;
    const queryClient = useQueryClient();

    const deleteMutation = useMutation({
        mutationFn: DeleteTransaction,
        onSuccess: async () => {
            toast.success('Transaction deleted successfully', {id: toastId});
            await Promise.all([
                queryClient.invalidateQueries({queryKey: ['transactions']}),
                queryClient.invalidateQueries({queryKey: ['overview']}),
                queryClient.invalidateQueries({queryKey: ['plaid-items']}),
                queryClient.invalidateQueries({queryKey: ['accounts']}),
            ]);
        },
        onError: () => {
            toast.error('Failed to delete transaction', {id: toastId});
        }
    });

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                        <AlertTriangle className="h-5 w-5"/>
                        Delete transaction?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {transaction.category.icon} {transaction.description || transaction.category.name}
                        {' · '}
                        {transaction.formattedAmount}. This action cannot be undone.
                        {transaction.source && ' Syncing the bank again will not bring it back.'}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => {
                        toast.loading('Deleting transaction...', {id: toastId});
                        deleteMutation.mutate({id: transaction.id});
                    }}>Delete</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export default DeleteTransactionDialog;
