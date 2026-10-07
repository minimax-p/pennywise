'use client';

import React, {ReactNode} from 'react';
import {Category} from "@prisma/client";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {DeleteCategory} from "@/app/(dashboard)/_actions/categories";
import {toast} from "sonner";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import {TransactionType} from "@/lib/types";
import {Badge} from "@/components/ui/badge";
import {AlertTriangle} from "lucide-react";
interface Props {
    trigger: ReactNode;
    category: Category;
}

function DeleteCategoryDialog({trigger, category}: Props) {
    const categoryIdentifier = `${category.name}-${category.type}`;

    const queryClient = useQueryClient();

    const deleteMutation = useMutation({
        mutationFn: DeleteCategory,
        onSuccess: async ()=>{
            toast.success('Category deleted successfully', {
                id: categoryIdentifier,
            })
            await queryClient.invalidateQueries({
                queryKey: ['categories']
            })
        },
        onError: ()=>{
            toast.error('Failed to delete category', {
                id: categoryIdentifier,
            })
        }
    })
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                        <AlertTriangle className="h-5 w-5" />
                        Confirm Deletion
                    </AlertDialogTitle>
                    <AlertDialogDescription className="pt-2">
                        <p className="mb-4">Are you absolutely sure you want to delete this category? This action cannot be undone.</p>
                        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4">
                            <p className="font-semibold text-destructive">You are about to delete:</p>
                            <div className="mt-2 flex items-center gap-2">
                                <Badge variant="outline" className="text-lg">
                                    {category.icon}
                                </Badge>
                                <span className="text-lg font-bold">{category.name}</span>
                            </div>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={()=>{
                        toast.loading('Deleting category...', {
                            id: categoryIdentifier,
                        })
                        deleteMutation.mutate({
                            name: category.name,
                            type: category.type as TransactionType  ,
                        })
                    }}>Continue</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export default DeleteCategoryDialog;