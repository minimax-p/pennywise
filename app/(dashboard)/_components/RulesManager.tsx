'use client';

import React, {ReactNode, useEffect, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {Loader2, Plus, Trash2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Switch} from "@/components/ui/switch";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from "@/components/ui/dialog";
import CategoryPicker, {PickedCategory} from "@/app/(dashboard)/_components/CategoryPicker";
import {PersonCombobox, PersonValue} from "@/app/(dashboard)/_components/PersonPicker";
import {DeleteRule, SaveRule} from "@/app/(dashboard)/_actions/rules";
import type {GetRulesResponseType} from "@/app/api/rules/route";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";
import {cn} from "@/lib/utils";

type Rule = GetRulesResponseType[number];

function useRules() {
    return useQuery<GetRulesResponseType>({
        queryKey: ['rules'],
        queryFn: () => fetch('/api/rules').then((res) => res.json()),
    });
}

// Your rules, made with "Always" on the Sort page or here
function RulesManager() {
    const rules = useRules();
    const list = Array.isArray(rules.data) ? rules.data : [];
    return (
        <div className="flex flex-col gap-3 text-sm">
            {list.length === 0 && (
                <p className="text-muted-foreground">
                    No rules yet. Turn on <b>Always file … like this</b> on the Sort page, or add one here, e.g. description
                    contains NETFLIX → Streaming.
                </p>
            )}
            {list.map((rule) => (
                <RuleDialog key={rule.id} rule={rule} trigger={
                    <button type="button" className="flex flex-col items-start gap-0.5 rounded-2xl border-2 bg-card px-3 py-2 text-left hover:bg-accent">
                        <span className="font-bold">{rule.what}</span>
                        <span className="text-muted-foreground">→ {rule.does}</span>
                    </button>
                }/>
            ))}
            <div>
                <RuleDialog trigger={<Button variant="outline"><Plus/>New rule</Button>}/>
            </div>
        </div>
    );
}

function RuleDialog({rule, trigger}: { rule?: Rule, trigger: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<Rule["kind"]>("contains");
    const [pattern, setPattern] = useState("");
    const [person, setPerson] = useState<PersonValue | null>(null);
    const [direction, setDirection] = useState<Rule["direction"]>("expense");
    const [category, setCategory] = useState<PickedCategory | null>(null);
    const [rename, setRename] = useState("");
    const [applyToPast, setApplyToPast] = useState(false);
    const queryClient = useQueryClient();
    const invalidate = useInvalidateMoney();

    useEffect(() => {
        if (!open) return;
        setKind(rule?.kind ?? "contains");
        setPattern(rule?.pattern ?? "");
        setPerson(rule?.person ?? null);
        setDirection(rule ? rule.direction : "expense");
        setCategory(rule?.category ? {name: rule.category.name, type: rule.category.type} : null);
        setRename(rule?.rename ?? "");
        setApplyToPast(false);
    }, [open, rule]);

    const done = async (message: string) => {
        toast.success(message);
        setOpen(false);
        await Promise.all([queryClient.invalidateQueries({queryKey: ['rules']}), invalidate()]);
    };

    const save = useMutation({
        mutationFn: async () => {
            if (kind === "person" && person && !("id" in person)) throw new Error("Pick someone who's already in Pennywise");
            const response = await SaveRule({
                id: rule?.id, kind, direction, rename, applyToPast, label: rule?.kind === "merchant" ? rule.label : null,
                pattern: kind === "person" ? null : pattern,
                personId: kind === "person" && person && "id" in person ? person.id : null,
                category,
            });
            if (!response.ok) throw new Error(response.error);
            return response.data.applied;
        },
        onSuccess: (applied) => done(applied > 0 ? `Saved, and filed ${applied} ${applied === 1 ? "transaction" : "transactions"}` : "Saved"),
        onError: (e) => toast.error(e.message),
    });
    const remove = useMutation({
        mutationFn: async () => {
            const response = await DeleteRule(rule!.id);
            if (!response.ok) throw new Error(response.error);
        },
        onSuccess: () => done("Rule removed"),
        onError: (e) => toast.error(e.message),
    });

    const chip = (active: boolean) => cn("rounded-full border-2 px-3 py-1.5 text-sm font-bold",
        active ? "border-primary bg-primary-soft" : "border-border bg-card text-muted-foreground");

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>{rule ? "Edit rule" : "New rule"}</DialogTitle>
                    <DialogDescription>Rules file new transactions before anything else, the same way every time.</DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate();
                }}>
                    <div className="flex flex-col gap-2">
                        <Label>When</Label>
                        {kind === "merchant" ? (
                            <p className="rounded-2xl bg-secondary px-3 py-2 font-bold">It&apos;s {rule?.label}</p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                <button type="button" className={chip(kind === "contains")} onClick={() => setKind("contains")}>The description contains</button>
                                <button type="button" className={chip(kind === "person")} onClick={() => setKind("person")}>It&apos;s with a person</button>
                            </div>
                        )}
                        {kind === "contains" && (
                            <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. NETFLIX" maxLength={191} aria-label="Text to look for"/>
                        )}
                        {kind === "person" && <PersonCombobox value={person} onChange={setPerson} placeholder="Pick a person"/>}
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>Money</Label>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" className={chip(direction === "expense")} onClick={() => setDirection("expense")}>Going out</button>
                            <button type="button" className={chip(direction === "income")} onClick={() => setDirection("income")}>Coming in</button>
                            <button type="button" className={chip(direction === null)} onClick={() => setDirection(null)}>Either</button>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>File under</Label>
                        <CategoryPicker kind={direction === "income" ? "income" : "expense"} value={category} onChange={setCategory}/>
                        {category && <button type="button" className="self-start text-xs font-bold text-muted-foreground" onClick={() => setCategory(null)}>No category, only rename</button>}
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="rule-rename">Show as (optional)</Label>
                        <Input id="rule-rename" value={rename} onChange={(e) => setRename(e.target.value)} placeholder="e.g. Netflix" maxLength={80}/>
                    </div>

                    <label className="flex items-center justify-between gap-2 rounded-2xl bg-secondary px-3 py-2 text-sm font-semibold">
                        Also re-file past transactions it matches
                        <Switch checked={applyToPast} onCheckedChange={setApplyToPast}/>
                    </label>

                    <DialogFooter className="items-stretch">
                        {rule && (
                            <Button type="button" variant="outline" className="sm:mr-auto" disabled={remove.isPending} onClick={() => remove.mutate()}>
                                <Trash2/>Remove
                            </Button>
                        )}
                        <Button type="submit" disabled={save.isPending}>
                            {save.isPending ? <Loader2 className="animate-spin"/> : "Save rule"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default RulesManager;
