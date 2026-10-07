'use client';

import React, {ReactNode, useCallback, useState} from 'react';
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {format} from "date-fns";
import {toast} from "sonner";
import {CalendarIcon, Loader2, Pencil} from "lucide-react";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from "@/components/ui/dialog";
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Calendar} from "@/components/ui/calendar";
import CategoryPicker from "@/app/(dashboard)/_components/CategoryPicker";
import {EditTransaction} from "@/app/(dashboard)/_actions/transactions";
import {EditTransactionSchema, EditTransactionSchemaType} from "@/schema/transaction";
import {DateToUTCDate, UTCDateToLocalDate} from "@/lib/helpers";
import AccountPicker from "@/app/(dashboard)/_components/AccountPicker";
import {cn} from "@/lib/utils";
import type {GetTransactionsHistoryResponseType} from "@/app/api/transactions/route";

interface Props {
    trigger: ReactNode;
    transaction: GetTransactionsHistoryResponseType[number];
}

const TOAST_ID = 'edit-transaction';

type Kind = EditTransactionSchemaType["type"];

const KIND_COLORS: Record<Kind, string> = {
    income: "text-sky-500",
    expense: "text-amber-500",
    transfer: "text-violet-400",
};

function EditTransactionDialog({trigger, transaction}: Props) {
    const [open, setOpen] = useState(false);
    const originalType = transaction.type as Kind;

    const getDefaultValues = useCallback((): EditTransactionSchemaType => ({
        id: transaction.id,
        type: originalType,
        amount: transaction.amount,
        description: transaction.description,
        date: UTCDateToLocalDate(new Date(transaction.date)),
        category: originalType === "transfer" ? undefined : transaction.category.name,
        accountId: transaction.accountId,
        toAccountId: transaction.toAccountId,
    }), [transaction, originalType]);

    const form = useForm<EditTransactionSchemaType>({
        resolver: zodResolver(EditTransactionSchema),
        defaultValues: getDefaultValues(),
    });

    // The row can change after a refetch, so start every edit from its current values
    const handleOpenChange = useCallback((next: boolean) => {
        if (next) form.reset(getDefaultValues());
        setOpen(next);
    }, [form, getDefaultValues]);

    const handleCategoryChange = useCallback((value: string) => {
        form.setValue('category', value);
    }, [form]);

    const type = form.watch('type');
    const changeType = (next: Kind) => {
        form.setValue('type', next);
        // Categories belong to one type, so switching starts from no category
        form.setValue('category', next === originalType && next !== "transfer" ? transaction.category.name : undefined);
        if (next !== "transfer") form.setValue('toAccountId', null);
    };

    const queryClient = useQueryClient();

    const {mutate, isPending} = useMutation({
        mutationFn: EditTransaction,
        onSuccess: async () => {
            toast.success('Transaction updated successfully', {id: TOAST_ID});
            await Promise.all([
                queryClient.invalidateQueries({queryKey: ['transactions']}),
                queryClient.invalidateQueries({queryKey: ['overview']}),
                queryClient.invalidateQueries({queryKey: ['accounts']}),
            ]);
            setOpen(false);
        },
        onError: () => {
            toast.error('Failed to update transaction', {id: TOAST_ID});
        }
    });

    const onSubmit = useCallback((values: EditTransactionSchemaType) => {
        toast.loading('Updating transaction...', {id: TOAST_ID});
        mutate({
            ...values,
            date: DateToUTCDate(values.date),
        });
    }, [mutate]);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                        <Pencil className={cn("h-6 w-6", KIND_COLORS[type])}/>
                        Edit {type}
                    </DialogTitle>
                    {transaction.source && (
                        <DialogDescription>
                            Imported from {transaction.source}. If the bank later changes the amount or date, the next sync updates them.
                        </DialogDescription>
                    )}
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <div className="grid grid-cols-3 gap-1 rounded-md bg-secondary p-1" role="radiogroup" aria-label="Type">
                            {(["expense", "income", "transfer"] as Kind[]).map((kind) => (
                                <button key={kind} type="button" role="radio" aria-checked={type === kind}
                                        onClick={() => changeType(kind)}
                                        className={cn(
                                            "rounded px-2 py-1 text-sm capitalize",
                                            type === kind ? cn("bg-background font-semibold", KIND_COLORS[kind]) : "text-muted-foreground"
                                        )}>
                                    {kind}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-4">
                            <FormField
                                control={form.control}
                                name="amount"
                                render={({field}) => (
                                    <FormItem className="flex-1">
                                        <FormLabel>Amount</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" inputMode="decimal" placeholder="0.00" {...field}/>
                                        </FormControl>
                                        <FormMessage/>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="date"
                                render={({field}) => (
                                    <FormItem className="flex-1">
                                        <FormLabel>Date</FormLabel>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <FormControl>
                                                    <Button variant="outline" className="w-full pl-3 text-left font-normal">
                                                        {format(field.value, "PPP")}
                                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50"/>
                                                    </Button>
                                                </FormControl>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar
                                                    mode="single"
                                                    selected={field.value}
                                                    onSelect={(value) => value && field.onChange(value)}
                                                    disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                        <FormMessage/>
                                    </FormItem>
                                )}
                            />
                        </div>
                        {type === "transfer" ? (
                            <div className="flex gap-4">
                                <FormField
                                    control={form.control}
                                    name="accountId"
                                    render={({field}) => (
                                        <FormItem className="flex-1">
                                            <FormLabel>From</FormLabel>
                                            <AccountPicker value={field.value} onChange={field.onChange} placeholder="From account"/>
                                            <FormMessage/>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="toAccountId"
                                    render={({field}) => (
                                        <FormItem className="flex-1">
                                            <FormLabel>To</FormLabel>
                                            <AccountPicker value={field.value} onChange={field.onChange} placeholder="To account"
                                                           excludeId={form.watch('accountId')}/>
                                            <FormMessage/>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        ) : (
                            <>
                                <FormField
                                    control={form.control}
                                    name="accountId"
                                    render={({field}) => (
                                        <FormItem>
                                            <FormLabel>Account</FormLabel>
                                            <AccountPicker value={field.value} onChange={field.onChange} allowNone/>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="category"
                                    render={() => (
                                        <FormItem>
                                            <FormLabel>Category</FormLabel>
                                            <FormControl>
                                                <CategoryPicker key={type} type={type} onChange={handleCategoryChange}
                                                                defaultValue={type === originalType ? transaction.category.name : undefined}/>
                                            </FormControl>
                                            <FormMessage/>
                                        </FormItem>
                                    )}
                                />
                            </>
                        )}
                        <FormField
                            control={form.control}
                            name="description"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel>Description</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g., Grocery shopping" {...field}/>
                                    </FormControl>
                                    <FormMessage/>
                                </FormItem>
                            )}
                        />
                    </form>
                </Form>
                <DialogFooter className="mt-2">
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={form.handleSubmit(onSubmit)}
                        disabled={isPending}
                        className={cn(
                            "text-white",
                            type === "income" && "bg-sky-500 hover:bg-sky-600",
                            type === "expense" && "bg-amber-500 hover:bg-amber-600",
                            type === "transfer" && "bg-violet-500 hover:bg-violet-600",
                        )}
                    >
                        {!isPending && "Save changes"}
                        {isPending && <Loader2 className="animate-spin h-5 w-5"/>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default EditTransactionDialog;
