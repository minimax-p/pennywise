'use client';

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import Link from "next/link";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {AnimatePresence, motion, PanInfo, useMotionValue, useTransform} from "framer-motion";
import {toast} from "sonner";
import {ArrowLeft, ArrowRight, CheckCheck, ChevronDown, Loader2, Pencil, Sparkles, StickyNote, Undo2} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PennyMark from "@/components/PennyMark";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Switch} from "@/components/ui/switch";
import CategoryPicker from "@/app/(dashboard)/_components/CategoryPicker";
import TransactionSheet, {useCurrencyFormatter} from "@/app/(dashboard)/_components/TransactionSheet";
import {TransactionItem} from "@/app/(dashboard)/_components/TransactionList";
import {Avatar} from "@/app/(dashboard)/_components/PersonPicker";
import {AcceptSuggestions, AskAiToSort, MakeTransfer, MarkPaidBack, ReturnToSort, SortGroup, UndoSort} from "@/app/(dashboard)/_actions/review";
import type {AutoSortedRow, SortCard, SortQueue} from "@/lib/sortQueue";
import type {TransactionRow} from "@/lib/transactionRows";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";
import {dayFormatter} from "@/lib/money";
import {cn} from "@/lib/utils";

const SWIPE = 110;

const SORTED_BY: Record<string, string> = {
    rule: "Your rule",
    history: "Like last time",
    keyword: "From the description",
    bank: "Bank's category",
    ai: "Jev",
};

function useSortQueue() {
    return useQuery<SortQueue>({
        queryKey: ['review', 'queue'],
        queryFn: () => fetch('/api/review').then((res) => res.json()),
    });
}

type Result = { ok: true, data: { sorted: number, undo: string, rule: string | null } } | { ok: false, error: string };
type Done = { key: string, undo: string };

function SortPage() {
    const [tab, setTab] = useState<"deck" | "auto">("deck");
    const queue = useSortQueue();
    const invalidate = useInvalidateMoney();
    const cards = useMemo(() => queue.data?.cards ?? [], [queue.data]);
    const suggested = cards.filter((c) => c.suggested);
    const notAskedYet = cards.filter((c) => c.rows.some((r) => r.category.name === "Unsorted")).length;

    const acceptAll = useMutation({
        mutationFn: () => AcceptSuggestions({ids: suggested.flatMap((c) => c.ids)}),
        onSuccess: (response) => {
            if (!response.ok) toast.error(response.error);
            else toast.success(`Kept ${response.data.accepted} suggested categories`);
        },
        onError: () => toast.error("Could not save"),
        onSettled: invalidate,
    });

    const askAi = useMutation({
        mutationFn: AskAiToSort,
        onMutate: () => toast.loading("Jev is sorting your transactions...", {id: 'ask-ai'}),
        onSuccess: (response) => {
            if (!response.ok) {
                toast.error(response.error, {id: 'ask-ai'});
                return;
            }
            const {sorted, suggested, left} = response.data;
            if (sorted + suggested === 0) {
                toast.info("Jev couldn't add anything new.", {id: 'ask-ai'});
                return;
            }
            toast.success(`Jev sorted ${sorted} and suggested categories for ${suggested}. ${left} left to check.`, {id: 'ask-ai'});
        },
        onError: () => toast.error("AI sorting failed", {id: 'ask-ai'}),
        onSettled: invalidate,
    });

    const tabClass = (active: boolean) => cn("rounded-xl px-4 py-2 text-sm font-extrabold transition-colors",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");

    return (
        <>
            <PageHeader title="Sort"
                        subtitle={queue.isLoading ? "Loading..." : queue.data?.total
                            ? `${queue.data.total} to sort. Swipe right to keep, left for later.`
                            : "Everything is sorted."}
                        actions={tab === "deck" && (
                            <>
                                {queue.data?.aiEnabled && notAskedYet > 0 && (
                                    <Button variant="outline" disabled={askAi.isPending} onClick={() => askAi.mutate()}>
                                        {askAi.isPending ? <Loader2 className="animate-spin"/> : <Sparkles/>}Ask Jev
                                    </Button>
                                )}
                                {suggested.length > 1 && (
                                    <Button variant="outline" disabled={acceptAll.isPending} onClick={() => acceptAll.mutate()}>
                                        {acceptAll.isPending ? <Loader2 className="animate-spin"/> : <CheckCheck/>}
                                        Keep all {suggested.reduce((n, c) => n + c.ids.length, 0)} suggestions
                                    </Button>
                                )}
                            </>
                        )}/>
            <div className="container flex flex-col gap-4 py-3">
                <div className="grid grid-cols-2 gap-1.5 self-start rounded-2xl bg-secondary p-1.5" role="tablist">
                    <button type="button" role="tab" aria-selected={tab === "deck"} className={tabClass(tab === "deck")} onClick={() => setTab("deck")}>
                        To sort{queue.data?.total ? ` · ${queue.data.total}` : ""}
                    </button>
                    <button type="button" role="tab" aria-selected={tab === "auto"} className={tabClass(tab === "auto")} onClick={() => setTab("auto")}>
                        Auto-sorted
                    </button>
                </div>
                {tab === "deck" ? (
                    <SkeletonWrapper isLoading={queue.isLoading}>
                        <Deck cards={cards}/>
                    </SkeletonWrapper>
                ) : <AutoSorted/>}
            </div>
        </>
    );
}

// One card at a time: the top card can be swiped, its buttons tapped, or keys pressed
function Deck({cards}: { cards: SortCard[] }) {
    const queryClient = useQueryClient();
    const invalidate = useInvalidateMoney();
    const [done, setDone] = useState<Done[]>([]);
    const [later, setLater] = useState<string[]>([]);
    const [exit, setExit] = useState<1 | -1>(1);
    const [busy, setBusy] = useState(false);
    const [always, setAlways] = useState(false);
    const [editing, setEditing] = useState<TransactionRow | null>(null);

    const doneKeys = new Set(done.map((d) => d.key));
    const waiting = cards.filter((c) => !doneKeys.has(c.key));
    const order = [...waiting.filter((c) => !later.includes(c.key)), ...later.flatMap((k) => waiting.filter((c) => c.key === k))];
    const card = order[0] ?? null;

    useEffect(() => setAlways(false), [card?.key]);

    const finish = useCallback(async (key: string, action: () => Promise<Result>, message: (sorted: number, rule: string | null) => string) => {
        setBusy(true);
        setExit(1);
        try {
            const response = await action();
            if (!response.ok) {
                toast.error(response.error);
                return;
            }
            const {undo, sorted, rule} = response.data;
            setDone((d) => [...d, {key, undo}]);
            setLater((l) => l.filter((k) => k !== key));
            toast.success(message(sorted, rule), {
                action: {label: "Undo", onClick: () => undoLast({key, undo})},
            });
            await Promise.all([
                queryClient.invalidateQueries({queryKey: ['review']}),
                queryClient.invalidateQueries({queryKey: ['home']}),
                queryClient.invalidateQueries({queryKey: ['transactions']}),
            ]);
        } catch {
            toast.error("Could not save");
        } finally {
            setBusy(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryClient]);

    const undoLast = async (target?: Done) => {
        const last = target ?? done[done.length - 1];
        if (!last) return;
        const response = await UndoSort(last.undo);
        if (!response.ok) {
            toast.error(response.error);
            return;
        }
        setDone((d) => d.filter((x) => x.undo !== last.undo));
        toast.success("Undone");
        await invalidate();
    };

    const file = useCallback((c: SortCard, name: string, type: string) => finish(c.key,
        () => SortGroup({ids: c.ids, category: name, categoryType: type as "income" | "expense", always}),
        (sorted, rule) => `${sorted > 1 ? `Filed ${sorted}` : "Filed"} as ${name}${rule ? `. ${rule} will be from now on` : ""}`),
    [finish, always]);

    const skip = useCallback((c: SortCard) => {
        setExit(-1);
        setLater((l) => [...l.filter((k) => k !== c.key), c.key]);
    }, []);

    const keep = useCallback((c: SortCard) => {
        const choice = c.choices.find((x) => x.name === c.suggested);
        if (choice) file(c, choice.name, choice.type);
        else toast.info("Pick a category for this one");
    }, [file]);

    // → keeps, ← later, 1-4 pick, Z undoes, E edits
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (!card || busy || editing || (target && /INPUT|TEXTAREA/.test(target.tagName)) || event.metaKey || event.ctrlKey) return;
            if (document.querySelector("[role=dialog]")) return;
            const key = event.key.toLowerCase();
            if (key === "arrowright") keep(card);
            else if (key === "arrowleft") skip(card);
            else if (/^[1-4]$/.test(key) && card.choices[Number(key) - 1]) {
                const choice = card.choices[Number(key) - 1];
                file(card, choice.name, choice.type);
            } else if (key === "z") void undoLast();
            else if (key === "e") setEditing(card.rows[0]);
            else return;
            event.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    if (!card) {
        return (
            <Card className="flex flex-col items-center gap-3 p-10 text-center">
                <PennyMark className="h-20 w-20"/>
                <p className="font-display text-2xl font-bold">All sorted!</p>
                <p className="text-sm text-muted-foreground">
                    New transactions that need a category show up here.{" "}
                    <Link href="/transactions" className="font-bold text-primary">See all transactions</Link>
                </p>
                {done.length > 0 && <Button variant="outline" onClick={() => undoLast()}><Undo2/>Undo the last one</Button>}
            </Card>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
            <div className="relative">
                {order.slice(1, 3).map((behind, i) => (
                    <div key={behind.key} aria-hidden
                         className="absolute inset-x-0 top-0 h-full rounded-[2rem] border-2 bg-card"
                         style={{transform: `translateY(${(i + 1) * 10}px) scale(${1 - (i + 1) * 0.04})`, zIndex: -1 - i, opacity: 0.8 - i * 0.3}}/>
                ))}
                <AnimatePresence mode="popLayout" custom={exit}>
                    <SwipeCard key={card.key} card={card} exit={exit} busy={busy} always={always} onAlways={setAlways}
                               onKeep={() => keep(card)} onSkip={() => skip(card)}
                               onFile={(name, type) => file(card, name, type)}
                               onPaidBack={() => finish(card.key, () => MarkPaidBack({ids: card.ids}),
                                   () => `Settled with ${card.person?.name}`)}
                               onTransfer={(accountId, name) => finish(card.key, () => MakeTransfer({ids: card.ids, accountId}),
                                   () => `Marked as a move with ${name}`)}
                               onEdit={(row) => setEditing(row)}/>
                </AnimatePresence>
            </div>

            <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" disabled={busy} onClick={() => skip(card)}><ArrowLeft/>Later</Button>
                <Button variant="outline" disabled={busy || done.length === 0} onClick={() => undoLast()}><Undo2/>Undo</Button>
                <Button disabled={busy || !card.suggested} onClick={() => keep(card)}>Keep<ArrowRight/></Button>
            </div>
            <p className="hidden text-center text-xs font-semibold text-muted-foreground md:block">
                Keys: → keep · ← later · 1–4 pick · Z undo · E edit
            </p>
            <TransactionSheet open={editing !== null} onOpenChange={(open) => {
                if (!open) {
                    setEditing(null);
                    void invalidate();
                }
            }} transaction={editing ?? undefined}/>
        </div>
    );
}

type CardProps = {
    card: SortCard, exit: 1 | -1, busy: boolean, always: boolean, onAlways: (v: boolean) => void,
    onKeep: () => void, onSkip: () => void, onFile: (name: string, type: string) => void,
    onPaidBack: () => void, onTransfer: (accountId: string, name: string) => void, onEdit: (row: TransactionRow) => void,
};

// A ref, so the deck's animation can measure the card leaving
const SwipeCard = React.forwardRef<HTMLDivElement, CardProps>(function SwipeCard(
    {card, exit, busy, always, onAlways, onKeep, onSkip, onFile, onPaidBack, onTransfer, onEdit}, ref,
) {
    const formatter = useCurrencyFormatter();
    const x = useMotionValue(0);
    const rotate = useTransform(x, [-240, 240], [-8, 8]);
    const keepOpacity = useTransform(x, [30, SWIPE], [0, 1]);
    const laterOpacity = useTransform(x, [-SWIPE, -30], [1, 0]);
    const income = card.type === "income";
    const single = card.rows.length === 1;
    const first = card.rows[0];
    const notes = card.rows.map((r) => r.note).filter(Boolean).slice(0, 2);

    const onDragEnd = (_: unknown, info: PanInfo) => {
        if (busy) return;
        if (info.offset.x > SWIPE && card.suggested) onKeep();
        else if (info.offset.x < -SWIPE) onSkip();
    };

    return (
        <motion.div ref={ref} style={{x, rotate}} drag={busy ? false : "x"} dragSnapToOrigin dragElastic={0.6} onDragEnd={onDragEnd}
                    initial={{opacity: 0, y: 16, scale: 0.97}} animate={{opacity: 1, y: 0, scale: 1}}
                    exit={{x: exit * 420, opacity: 0, rotate: exit * 10, transition: {duration: 0.22}}}
                    className="relative touch-pan-y select-none">
            <Card className={cn("flex flex-col gap-4 rounded-[2rem] p-5", busy && "opacity-70")}>
                <motion.span style={{opacity: keepOpacity}}
                             className="pointer-events-none absolute right-5 top-5 rotate-6 rounded-xl border-2 border-primary px-2 py-0.5 text-sm font-extrabold uppercase text-primary">
                    Keep
                </motion.span>
                <motion.span style={{opacity: laterOpacity}}
                             className="pointer-events-none absolute left-5 top-5 -rotate-6 rounded-xl border-2 border-muted-foreground px-2 py-0.5 text-sm font-extrabold uppercase text-muted-foreground">
                    Later
                </motion.span>

                <div className="flex flex-col items-center gap-1 pt-2 text-center">
                    {card.person && <Avatar name={card.person.name} className="mb-1 h-12 w-12 text-base"/>}
                    <p className="max-w-full truncate font-display text-2xl font-semibold">{card.name || "(no description)"}</p>
                    <p className={cn("font-display text-4xl font-bold money", income ? "text-income-ink" : "text-foreground")}>
                        {income ? "+" : "−"}{formatter.format(card.total)}
                    </p>
                    <p className="text-xs font-bold text-muted-foreground">
                        {single
                            ? [dayFormatter.format(new Date(first.date)), first.accountName].filter(Boolean).join(" · ")
                            : `${card.rows.length} ${income ? "payments" : "charges"} · ${card.rows.slice(0, 3).map((r) => r.formattedAmount).join(", ")}${card.rows.length > 3 ? "…" : ""}`}
                    </p>
                    {card.person && (
                        <p className="text-xs font-bold text-muted-foreground">
                            {card.person.name}{card.person.owes > 0 ? ` owes you ${formatter.format(card.person.owes)}` : ""}
                        </p>
                    )}
                    {notes.map((note) => (
                        <p key={note} className="mt-1 flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-secondary px-3 py-1.5 text-sm font-semibold">
                            <StickyNote className="h-3.5 w-3.5 text-muted-foreground"/>{note}
                        </p>
                    ))}
                </div>

                {card.transfer && (
                    <div className="flex flex-col gap-2 rounded-2xl bg-move-soft p-3 text-sm">
                        <p className="font-bold text-move-ink">
                            Looks like money moved {card.transfer.into ? "to" : "from"} {card.transfer.accountName}, not {income ? "income" : "spending"}.
                        </p>
                        <Button type="button" size="sm" variant="outline" disabled={busy}
                                onClick={() => onTransfer(card.transfer!.accountId, card.transfer!.accountName)}>
                            Yes, it&apos;s a move
                        </Button>
                    </div>
                )}

                {card.paidBack && (
                    <Button type="button" size="lg" disabled={busy} onClick={onPaidBack}>
                        <span role="img" aria-hidden>↩️</span>{card.person!.name.split(" ")[0]} paid me back
                    </Button>
                )}

                <div className="grid grid-cols-2 gap-2">
                    {card.choices.map((choice, index) => (
                        <button key={choice.name} type="button" disabled={busy} onClick={() => onFile(choice.name, choice.type)}
                                className={cn("flex min-h-12 items-center gap-2 rounded-2xl border-2 px-3 py-2 text-left text-sm font-bold transition-transform active:translate-y-[2px]",
                                    choice.name === card.suggested && !card.paidBack
                                        ? "border-primary bg-primary text-primary-foreground shadow-[0_3px_0_0_hsl(var(--primary-lip))]"
                                        : "border-border bg-card shadow-[0_3px_0_0_hsl(var(--border))]")}>
                            <span className="hidden text-xs opacity-60 md:inline">{index + 1}</span>
                            <span role="img" className="text-lg">{choice.icon}</span>
                            <span className="min-w-0 flex-1 truncate">{choice.name}</span>
                            {choice.probability !== null && <span className="text-xs opacity-70">{Math.round(choice.probability * 100)}%</span>}
                        </button>
                    ))}
                </div>

                <div className="flex flex-wrap gap-2">
                    <CategoryPicker kind={card.type} value={null} onChange={(c) => onFile(c.name, c.type)} trigger={
                        <Button type="button" variant="outline" size="sm" disabled={busy}>Other category<ChevronDown/></Button>
                    }/>
                    {single && (
                        <Button type="button" variant="outline" size="sm" onClick={() => onEdit(first)}>
                            <span role="img" aria-hidden>✂️</span>Split or edit
                        </Button>
                    )}
                    {!single && (
                        <Button type="button" variant="outline" size="sm" onClick={() => onEdit(first)}><Pencil/>Edit the newest</Button>
                    )}
                </div>

                {card.canAlways && (
                    <label className="flex items-center justify-between gap-2 rounded-2xl bg-secondary px-3 py-2 text-sm font-semibold">
                        <span>Always file <b>{card.person?.name ?? card.name}</b> like this</span>
                        <Switch checked={always} onCheckedChange={onAlways}/>
                    </label>
                )}
            </Card>
        </motion.div>
    );
});

// What Pennywise filed by itself in the last month, to spot-check
function AutoSorted() {
    const query = useQuery<AutoSortedRow[]>({
        queryKey: ['review', 'auto'],
        queryFn: () => fetch('/api/review/auto').then((res) => res.json()),
    });
    const [editing, setEditing] = useState<AutoSortedRow | null>(null);
    const invalidate = useInvalidateMoney();
    const rows = query.data ?? [];

    const wrong = useMutation({
        mutationFn: async (id: string) => {
            const response = await ReturnToSort(id);
            if (!response.ok) throw new Error(response.error);
        },
        onSuccess: async () => {
            toast.success("Back on the Sort page");
            await invalidate();
        },
        onError: (e) => toast.error(e.message),
    });

    return (
        <SkeletonWrapper isLoading={query.isLoading}>
            <Card className="flex flex-col p-3 md:p-4">
                <p className="px-2 pb-2 text-sm text-muted-foreground">
                    Filed by your rules, your past choices, keywords or Jev in the last 30 days. Tap one to change it.
                </p>
                {rows.length === 0 && <p className="px-2 py-4 text-sm text-muted-foreground">Nothing yet.</p>}
                {rows.map((row) => (
                    <div key={row.id} className="flex items-center gap-1">
                        <div className="min-w-0 flex-1">
                            <TransactionItem row={row} onOpen={() => setEditing(row)} showDate/>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                                {SORTED_BY[row.categorizedBy ?? ""] ?? "Auto"}
                            </span>
                            <button type="button" className="text-xs font-bold text-primary" disabled={wrong.isPending}
                                    onClick={() => wrong.mutate(row.id)}>
                                Wrong?
                            </button>
                        </div>
                    </div>
                ))}
            </Card>
            <TransactionSheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} transaction={editing ?? undefined}/>
        </SkeletonWrapper>
    );
}

export default SortPage;
