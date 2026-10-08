'use client';

import React, {useState} from 'react';
import {useRouter} from "next/navigation";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {Loader2, Trash2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from "@/components/ui/dialog";
import {StartOver as startOver, StartOverScope} from "@/app/(dashboard)/_actions/startOver";

const CHOICES: { scope: StartOverScope, label: string, title: string, detail: string }[] = [
    {
        scope: "transactions", label: "Delete all transactions", title: "Delete all transactions?",
        detail: "Every transaction, the record of what you imported, and the balances read from statements are deleted. "
            + "Your accounts (with the balances you typed), categories, rules, people and shortcuts stay, so you can import again.",
    },
    {
        scope: "everything", label: "Delete everything", title: "Delete everything?",
        detail: "Everything goes: transactions, accounts, people, rules, your own categories, shortcut keys, linked banks and "
            + "settings. Built-in categories go back to how they started. Pennywise is like a fresh install afterwards.",
    },
];

// Start over after an import went wrong
function StartOver() {
    return (
        <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
                This can&apos;t be undone from here. To keep a copy first, run <code>./scripts/deploy.sh backup</code> on your
                computer. The server also keeps a backup from every night and from before every update.
            </p>
            <div className="flex flex-wrap gap-2">
                {CHOICES.map((choice) => <Confirm key={choice.scope} {...choice}/>)}
            </div>
        </div>
    );
}

function Confirm({scope, label, title, detail}: typeof CHOICES[number]) {
    const [open, setOpen] = useState(false);
    const [typed, setTyped] = useState("");
    const queryClient = useQueryClient();
    const router = useRouter();

    const run = useMutation({
        mutationFn: async () => {
            const result = await startOver(scope, typed);
            if (!result.ok) throw new Error(result.error);
            return result.data.transactions;
        },
        onSuccess: async (count) => {
            toast.success(`Deleted ${count} ${count === 1 ? "transaction" : "transactions"}`);
            setOpen(false);
            queryClient.clear();
            router.push(scope === "everything" ? "/wizard" : "/");
            router.refresh();
        },
        onError: (e) => toast.error(e.message),
    });

    return (
        <Dialog open={open} onOpenChange={(next) => {
            setOpen(next);
            setTyped("");
        }}>
            <DialogTrigger asChild>
                <Button variant="outline" className="text-destructive"><Trash2/>{label}</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{detail}</DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-3" onSubmit={(e) => {
                    e.preventDefault();
                    run.mutate();
                }}>
                    <label className="flex flex-col gap-2 text-sm font-semibold">
                        Type DELETE to confirm
                        <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder="DELETE"/>
                    </label>
                    <DialogFooter>
                        <Button type="submit" variant="destructive" disabled={typed.trim().toUpperCase() !== "DELETE" || run.isPending}>
                            {run.isPending ? <Loader2 className="animate-spin"/> : <Trash2/>}{label}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default StartOver;
