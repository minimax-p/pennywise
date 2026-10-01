"use client";

import {ReactNode, useCallback, useState} from "react";
import {TransactionType} from "@/lib/types";

interface Props{
    trigger: ReactNode;
    type: TransactionType;
}

import React from 'react';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import {cn} from "@/lib/utils";
import {useForm} from "react-hook-form";
import {CreateTransactionSchema, CreateTransactionSchemaType} from "@/schema/transaction";
import {zodResolver} from "@hookform/resolvers/zod";
import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";
import {Input} from "@/components/ui/input";
import CategoryPicker from "@/app/(dashboard)/_components/CategoryPicker";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Button} from "@/components/ui/button";
import {format} from "date-fns";
import {CalendarIcon, Loader2, PlusCircle} from "lucide-react";
import {Calendar} from "@/components/ui/calendar";
import {CreateTransaction} from "@/app/(dashboard)/_actions/transactions";
import {toast} from "sonner";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {DateToUTCDate} from "@/lib/helpers";
import {Card, CardContent} from "@/components/ui/card";
// import {Button} from "react-day-picker";

function CreateTransactionDialog({trigger, type}: Props) {
    const form = useForm<CreateTransactionSchemaType>({
        resolver: zodResolver(CreateTransactionSchema),
        defaultValues:{
            type,
            date: new Date()
        }
    })
    const [open, setOpen] = useState(false);
    const handleCategoryChange = useCallback((value: string)=>{
        form.setValue('category', value);
    }, [form])

    const queryClient = useQueryClient();

    const {mutate, isPending} = useMutation({
        mutationFn: CreateTransaction,
        onSuccess: ()=>{
            toast.success("Transaction created successfully 💸", {id: 'create-transaction'});
            form.reset({
                type,
                description: "",
                amount: 0,
                date: new Date(),
                category: undefined,
            });

            queryClient.invalidateQueries({
                queryKey: ['overview']
            });
            queryClient.invalidateQueries({
                queryKey: ['transactions']
            });

            setOpen((prev)=>!prev);
        },
        onError: ()=>{
            toast.error("Failed to create transaction", {id: 'create-transaction'});
        }
    })

    const onSubmit = useCallback((values: CreateTransactionSchemaType)=>{
        toast.loading("Creating transaction...", {id: 'create-transaction'});
        mutate({
            ...values,
            date: DateToUTCDate(values.date)
        });
    }, [mutate]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                        <PlusCircle className={cn("h-6 w-6", type === "income" ? "text-sky-500" : "text-amber-500")} />
                        New {type} transaction
                    </DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <div className="space-y-4">
                            <div className="flex gap-4">
                                <FormField
                                    control={form.control}
                                    name="amount"
                                    render={({ field }) => (
                                        <FormItem className="flex-1">
                                            <FormLabel>Amount</FormLabel>
                                            <FormControl>
                                                <Input type="number" step="0.01" placeholder="0.00" {...field} />
                                            </FormControl>
                                            <FormDescription>Enter the transaction amount</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="date"
                                    render={({ field }) => (
                                        <FormItem className="flex-1">
                                            <FormLabel>Date</FormLabel>
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <FormControl>
                                                        <Button
                                                            variant={"outline"}
                                                            className={cn(
                                                                "w-full pl-3 text-left font-normal",
                                                                !field.value && "text-muted-foreground"
                                                            )}
                                                        >
                                                            {field.value ? (
                                                                format(field.value, "PPP")
                                                            ) : (
                                                                <span>Pick a date</span>
                                                            )}
                                                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                        </Button>
                                                    </FormControl>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-auto p-0" align="start">
                                                    <Calendar
                                                        mode="single"
                                                        selected={field.value}
                                                        onSelect={field.onChange}
                                                        disabled={(date) =>
                                                            date > new Date() || date < new Date("1900-01-01")
                                                        }
                                                        initialFocus
                                                    />
                                                </PopoverContent>
                                            </Popover>
                                            <FormDescription>Choose the transaction date</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <FormField
                                control={form.control}
                                name="category"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Category</FormLabel>
                                        <FormControl>
                                            <CategoryPicker type={type} onChange={handleCategoryChange} />
                                        </FormControl>
                                        <FormDescription>Select a category for your transaction</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Description</FormLabel>
                                        <FormControl>
                                            <Input placeholder="e.g., Grocery shopping" {...field} />
                                        </FormControl>
                                        <FormDescription>Briefly describe your transaction (optional)</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </form>
                </Form>
                <DialogFooter className="mt-6">
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={form.handleSubmit(onSubmit)}
                        disabled={isPending}
                        className={cn(
                            "text-white",
                            type === "income" ? "bg-sky-500 hover:bg-sky-600" : "bg-amber-500 hover:bg-amber-600"
                        )}
                    >
                        {!isPending && "Create Transaction"}
                        {isPending && <Loader2 className="animate-spin h-5 w-5" />}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

    );
}

export default CreateTransactionDialog;