'use client';

import React, {useEffect, useState} from 'react';
import {useMutation, useQuery} from "@tanstack/react-query";
import {toast} from "sonner";
import {Loader2, Trash2} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Card} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Avatar, usePeople} from "@/app/(dashboard)/_components/PersonPicker";
import {CompactList} from "@/app/(dashboard)/_components/TransactionList";
import {useCurrencyFormatter} from "@/app/(dashboard)/_components/TransactionSheet";
import {DeletePerson, MergePeople, RenamePerson} from "@/app/(dashboard)/_actions/people";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";
import type {GetPeopleResponseType} from "@/app/api/people/route";
import type {GetPersonResponseType} from "@/app/api/people/[id]/route";
import {cn} from "@/lib/utils";

type PersonRow = GetPeopleResponseType["people"][number];

function status(person: { balance: number }, formatter: Intl.NumberFormat) {
    if (person.balance > 0) return {text: `owes you ${formatter.format(person.balance)}`, className: "text-income-ink"};
    if (person.balance < 0) return {text: `you owe ${formatter.format(-person.balance)}`, className: "text-spend-ink"};
    return {text: "settled", className: "text-muted-foreground"};
}

function PeoplePage() {
    const people = usePeople();
    const formatter = useCurrencyFormatter();
    const [open, setOpen] = useState<PersonRow | null>(null);
    const data = people.data;

    return (
        <>
            <PageHeader title="People" subtitle="Who owes you, and your Zelle and Venmo"/>
            <div className="container flex flex-col gap-4 py-3">
                <SkeletonWrapper isLoading={people.isLoading}>
                    <div className="grid grid-cols-2 gap-3">
                        <Card className="flex flex-col gap-1 p-4">
                            <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">🤝 Owed to you</span>
                            <span className="font-display text-2xl font-semibold text-income-ink money">{formatter.format(data?.totals.owedToYou ?? 0)}</span>
                        </Card>
                        <Card className="flex flex-col gap-1 p-4">
                            <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">🧾 You owe</span>
                            <span className="font-display text-2xl font-semibold money">{formatter.format(data?.totals.youOwe ?? 0)}</span>
                        </Card>
                    </div>
                </SkeletonWrapper>

                <SkeletonWrapper isLoading={people.isLoading}>
                    <Card className="flex flex-col p-3 md:p-4">
                        <h2 className="px-2 pb-1 font-display text-xl font-semibold">Everyone</h2>
                        {data && data.people.length === 0 && (
                            <p className="px-2 py-4 text-sm text-muted-foreground">
                                No one yet. People show up here from the Zelle and Venmo payments you import, and when you split
                                a bill with someone using ✂️ Split.
                            </p>
                        )}
                        {(data?.people ?? []).map((person) => {
                            const s = status(person, formatter);
                            return (
                                <button key={person.id} type="button" onClick={() => setOpen(person)}
                                        className="flex items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-accent">
                                    <Avatar name={person.name} className="h-11 w-11 text-sm"/>
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate font-bold">{person.name}</span>
                                        <span className="truncate text-xs font-semibold text-muted-foreground">
                                            {person.lastNote ? `“${person.lastNote}”` : `${person.count} ${person.count === 1 ? "payment" : "payments"}`}
                                        </span>
                                    </span>
                                    <span className={cn("shrink-0 text-sm font-bold money", s.className)}>{s.text}</span>
                                </button>
                            );
                        })}
                    </Card>
                </SkeletonWrapper>

                {data && data.recent.length > 0 && (
                    <Card className="p-3 md:p-4">
                        <h2 className="px-2 pb-1 font-display text-xl font-semibold">Recent Zelle and Venmo</h2>
                        <CompactList rows={data.recent}/>
                    </Card>
                )}
            </div>
            <PersonSheet person={open} onClose={() => setOpen(null)} everyone={data?.people ?? []}/>
        </>
    );
}

function PersonSheet({person, onClose, everyone}: { person: PersonRow | null, onClose: () => void, everyone: PersonRow[] }) {
    const formatter = useCurrencyFormatter();
    const invalidate = useInvalidateMoney();
    const [name, setName] = useState("");
    const [mergeInto, setMergeInto] = useState("");
    const detail = useQuery<GetPersonResponseType>({
        queryKey: ["person", person?.id],
        queryFn: () => fetch(`/api/people/${person!.id}`).then((res) => res.json()),
        enabled: Boolean(person),
    });
    useEffect(() => {
        setName(person?.name ?? "");
        setMergeInto("");
    }, [person]);

    const done = async (message: string) => {
        toast.success(message);
        await invalidate();
    };
    const rename = useMutation({
        mutationFn: async () => {
            const result = await RenamePerson(person!.id, name);
            if (!result.ok) throw new Error(result.error);
        },
        onSuccess: () => done("Renamed"),
        onError: (e) => toast.error(e.message),
    });
    const merge = useMutation({
        mutationFn: async () => {
            const result = await MergePeople(person!.id, mergeInto);
            if (!result.ok) throw new Error(result.error);
        },
        onSuccess: async () => {
            onClose();
            await done("Merged");
        },
        onError: (e) => toast.error(e.message),
    });
    const remove = useMutation({
        mutationFn: async () => {
            const result = await DeletePerson(person!.id);
            if (!result.ok) throw new Error(result.error);
        },
        onSuccess: async () => {
            onClose();
            await done("Removed");
        },
        onError: (e) => toast.error(e.message),
    });

    const balance = detail.data?.balance ?? person?.balance ?? 0;
    const s = status({balance}, formatter);

    return (
        <Dialog open={person !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[520px]">
                {person && (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-3">
                                <Avatar name={person.name} className="h-10 w-10 text-sm"/>{person.name}
                            </DialogTitle>
                            <DialogDescription className={cn("font-bold", s.className)}>
                                {balance === 0 ? "All settled" : s.text[0].toUpperCase() + s.text.slice(1)}
                            </DialogDescription>
                        </DialogHeader>

                        <form className="flex gap-2" onSubmit={(e) => {
                            e.preventDefault();
                            rename.mutate();
                        }}>
                            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Name"/>
                            <Button type="submit" variant="outline" disabled={rename.isPending || name.trim() === person.name}>
                                {rename.isPending ? <Loader2 className="animate-spin"/> : "Rename"}
                            </Button>
                        </form>
                        {person.aliases.length > 0 && (
                            <p className="text-xs text-muted-foreground">On bank lines as {person.aliases.join(", ")}</p>
                        )}

                        <div className="flex flex-col gap-1">
                            <h3 className="font-display text-lg font-semibold">Money with {person.name.split(" ")[0]}</h3>
                            {detail.data ? (
                                detail.data.transactions.length > 0
                                    ? <CompactList rows={detail.data.transactions}/>
                                    : <p className="text-sm text-muted-foreground">Nothing yet.</p>
                            ) : <Loader2 className="mx-auto animate-spin text-muted-foreground"/>}
                        </div>

                        {everyone.length > 1 && (
                            <div className="flex flex-col gap-2">
                                <Label>Same person as someone else?</Label>
                                <div className="flex gap-2">
                                    <Select value={mergeInto} onValueChange={setMergeInto}>
                                        <SelectTrigger><SelectValue placeholder="Merge into…"/></SelectTrigger>
                                        <SelectContent>
                                            {everyone.filter((p) => p.id !== person.id).map((p) => (
                                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button type="button" variant="outline" disabled={!mergeInto || merge.isPending} onClick={() => merge.mutate()}>
                                        {merge.isPending ? <Loader2 className="animate-spin"/> : "Merge"}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {!person.hasShares && (
                            <Button type="button" variant="ghost" className="self-start text-destructive" disabled={remove.isPending}
                                    onClick={() => remove.mutate()}>
                                <Trash2/>Remove {person.name}
                            </Button>
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

export default PeoplePage;
