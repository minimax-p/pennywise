'use client';

import React, {ReactNode, useState} from 'react';
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {ArrowRightLeft, Loader2} from "lucide-react";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import AccountPicker, {useRememberedAccount} from "@/app/(dashboard)/_components/AccountPicker";
import {CreateTransfer} from "@/app/(dashboard)/_actions/transactions";
import {CreateTransferSchema} from "@/schema/transaction";
import {DateToUTCDate, ToDayString} from "@/lib/helpers";

function CreateTransferDialog({trigger}: { trigger: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [fromAccountId, setFromAccountId] = useRememberedAccount('pennywise:transfer-from');
    const [toAccountId, setToAccountId] = useRememberedAccount('pennywise:transfer-to');
    const [amount, setAmount] = useState("");
    const [day, setDay] = useState(ToDayString(new Date()));
    const [description, setDescription] = useState("");
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationFn: CreateTransfer,
        onSuccess: async () => {
            toast.success("Transfer recorded", {id: 'create-transfer'});
            setAmount("");
            setDescription("");
            setOpen(false);
            await Promise.all([
                queryClient.invalidateQueries({queryKey: ['accounts']}),
                queryClient.invalidateQueries({queryKey: ['transactions']}),
            ]);
        },
        onError: () => {
            toast.error("Could not record the transfer", {id: 'create-transfer'});
        },
    });

    const submit = () => {
        const [year, month, date] = day.split("-").map(Number);
        const values = {
            amount,
            description,
            date: DateToUTCDate(new Date(year, month - 1, date, new Date().getHours(), new Date().getMinutes())),
            fromAccountId: fromAccountId ?? "",
            toAccountId: toAccountId ?? "",
        };
        const parsed = CreateTransferSchema.safeParse(values);
        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? "Check the form");
            return;
        }
        setError(null);
        toast.loading("Recording transfer...", {id: 'create-transfer'});
        mutation.mutate(parsed.data);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-2xl font-bold">
                        <ArrowRightLeft className="h-6 w-6 text-violet-400"/>
                        New transfer
                    </DialogTitle>
                    <DialogDescription>
                        Money moved between your own accounts, like paying the credit card or moving savings.
                        It is not counted as income or spending.
                    </DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                }}>
                    <div className="flex gap-4">
                        <div className="flex flex-1 flex-col gap-2">
                            <Label>From</Label>
                            <AccountPicker value={fromAccountId} onChange={setFromAccountId} placeholder="From account"/>
                        </div>
                        <div className="flex flex-1 flex-col gap-2">
                            <Label>To</Label>
                            <AccountPicker value={toAccountId} onChange={setToAccountId} placeholder="To account"
                                           excludeId={fromAccountId}/>
                        </div>
                    </div>
                    <div className="flex gap-4">
                        <div className="flex flex-1 flex-col gap-2">
                            <Label htmlFor="transfer-amount">Amount</Label>
                            <Input id="transfer-amount" type="number" step="0.01" inputMode="decimal" placeholder="0.00"
                                   value={amount} onChange={(e) => setAmount(e.target.value)} required/>
                        </div>
                        <div className="flex flex-1 flex-col gap-2">
                            <Label htmlFor="transfer-day">Date</Label>
                            <Input id="transfer-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} required/>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="transfer-description">Note (optional)</Label>
                        <Input id="transfer-description" placeholder="e.g. Discover payment" value={description}
                               onChange={(e) => setDescription(e.target.value)}/>
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={mutation.isPending} className="bg-violet-500 text-white hover:bg-violet-600">
                            {mutation.isPending ? <Loader2 className="h-5 w-5 animate-spin"/> : "Record transfer"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default CreateTransferDialog;
