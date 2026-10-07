'use client';

import React, {useState} from 'react';
import Link from "next/link";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {CheckCheck, Loader2, Pencil, Sparkles, StickyNote} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PennyMark from "@/components/PennyMark";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Switch} from "@/components/ui/switch";
import CategoryPicker from "@/app/(dashboard)/_components/CategoryPicker";
import TransactionSheet from "@/app/(dashboard)/_components/TransactionSheet";
import {AcceptSuggestions, AskAiToSort, SortTransaction} from "@/app/(dashboard)/_actions/review";
import type {GetReviewQueueResponseType} from "@/app/api/review/route";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";
import {dayFormatter} from "@/lib/money";
import {TransactionType} from "@/lib/types";
import {cn} from "@/lib/utils";

type ReviewItem = GetReviewQueueResponseType["items"][number];

const SOURCE_LABELS: Record<string, string> = {
    manual: "Added by hand",
    import: "Imported",
    apple_pay: "Apple Pay",
    plaid: "Bank sync",
};

function useReviewQueue() {
    return useQuery<GetReviewQueueResponseType>({
        queryKey: ['review', 'queue'],
        queryFn: () => fetch('/api/review').then((res) => res.json()),
    });
}

function ReviewPage() {
    const queue = useReviewQueue();
    const invalidate = useInvalidateMoney();
    const items = queue.data?.items ?? [];
    const withSuggestion = items.filter((i) => i.category.name !== "Unsorted");
    // Jev answers each transaction once; asking again only helps new ones
    const notAskedYet = items.filter((i) => i.categorizedBy !== "ai").length;

    const acceptAll = useMutation({
        mutationFn: () => AcceptSuggestions({ids: withSuggestion.map((i) => i.id)}),
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
                toast.info("Jev couldn't add anything new. Tap the right category below.", {id: 'ask-ai'});
                return;
            }
            toast.success(`Jev sorted ${sorted} and suggested categories for ${suggested}. ${left} left to check.`, {id: 'ask-ai'});
        },
        onError: () => toast.error("AI sorting failed", {id: 'ask-ai'}),
        onSettled: invalidate,
    });

    return (
        <>
            <PageHeader title="Sort"
                        subtitle={queue.isLoading ? "Loading..." : queue.data?.total
                            ? `${queue.data.total} to check. Tap the right category.`
                            : "Everything is sorted."}
                        actions={
                            <>
                                {queue.data?.aiEnabled && notAskedYet > 0 && (
                                    <Button variant="outline" disabled={askAi.isPending} onClick={() => askAi.mutate()}>
                                        {askAi.isPending ? <Loader2 className="animate-spin"/> : <Sparkles/>}
                                        Ask Jev about {notAskedYet}
                                    </Button>
                                )}
                                {withSuggestion.length > 0 && (
                                    <Button disabled={acceptAll.isPending} onClick={() => acceptAll.mutate()}>
                                        {acceptAll.isPending ? <Loader2 className="animate-spin"/> : <CheckCheck/>}
                                        Keep all {withSuggestion.length} suggestions
                                    </Button>
                                )}
                            </>
                        }/>
            <div className="container flex flex-col gap-3 py-3">
                <SkeletonWrapper isLoading={queue.isLoading}>
                    {items.length === 0 ? (
                        <Card className="flex flex-col items-center gap-3 p-10 text-center">
                            <PennyMark className="h-20 w-20"/>
                            <p className="font-display text-2xl font-bold">All sorted!</p>
                            <p className="text-sm text-muted-foreground">
                                New transactions that need a category show up here. <Link href="/transactions" className="font-bold text-primary">See all transactions</Link>
                            </p>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                            {items.map((item) => <ReviewCard key={item.id} item={item}/>)}
                        </div>
                    )}
                </SkeletonWrapper>
            </div>
        </>
    );
}

function ReviewCard({item}: { item: ReviewItem }) {
    const [applyToMerchant, setApplyToMerchant] = useState(true);
    const [editing, setEditing] = useState(false);
    const queryClient = useQueryClient();
    const invalidate = useInvalidateMoney();

    const sort = useMutation({
        mutationFn: ({category, categoryType}: { category: string, categoryType?: TransactionType }) =>
            SortTransaction({id: item.id, category, categoryType, applyToMerchant: applyToMerchant && item.sameMerchant > 0}),
        onSuccess: (response, {category}) => {
            if (!response.ok) {
                toast.error(response.error);
                return;
            }
            // Drop the sorted card right away; the refetch confirms
            queryClient.setQueryData<GetReviewQueueResponseType>(['review', 'queue'], (data) => data && {
                ...data,
                total: Math.max(0, data.total - response.data.sorted),
                items: data.items.filter((i) => i.id !== item.id),
            });
            toast.success(response.data.sorted > 1 ? `Sorted ${response.data.sorted} as ${category}` : `Sorted as ${category}`);
        },
        onError: () => toast.error("Could not save"),
        onSettled: invalidate,
    });

    const income = item.type === "income";

    return (
        <Card className={cn("flex flex-col gap-3 p-4", sort.isPending && "opacity-60")}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate font-display text-lg font-semibold">{item.description || "(no description)"}</p>
                    <p className="text-xs font-bold text-muted-foreground">
                        {[dayFormatter.format(new Date(item.date)), item.accountName, item.source ?? SOURCE_LABELS[item.entrySource]]
                            .filter(Boolean).join(" · ")}
                    </p>
                </div>
                <span className={cn("whitespace-nowrap font-display text-lg font-semibold money", income ? "text-income-ink" : "text-foreground")}>
                    {income ? "+" : "−"}{item.formattedAmount}
                </span>
            </div>
            {item.note && (
                <p className="flex items-center gap-1.5 self-start rounded-2xl rounded-bl-sm bg-secondary px-3 py-1.5 text-sm font-semibold">
                    <StickyNote className="h-3.5 w-3.5 text-muted-foreground"/>{item.note}
                </p>
            )}

            <div className="grid grid-cols-2 gap-2">
                {item.choices.map((choice, index) => (
                    <button key={choice.name} type="button" disabled={sort.isPending}
                            onClick={() => sort.mutate({category: choice.name})}
                            className={cn("flex min-h-12 items-center gap-2 rounded-2xl border-2 px-3 py-2 text-left text-sm font-bold transition-transform active:translate-y-[2px]",
                                index === 0 && item.category.name !== "Unsorted"
                                    ? "border-primary bg-primary text-primary-foreground shadow-[0_3px_0_0_hsl(var(--primary-lip))]"
                                    : "border-border bg-card shadow-[0_3px_0_0_hsl(var(--border))]")}>
                        <span role="img" className="text-lg">{choice.icon}</span>
                        <span className="min-w-0 flex-1 truncate">{choice.name}</span>
                        {choice.probability !== null && <span className="text-xs opacity-70">{Math.round(choice.probability * 100)}%</span>}
                    </button>
                ))}
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
                <CategoryPicker kind={item.type as TransactionType} value={null}
                                onChange={(c) => sort.mutate({category: c.name, categoryType: c.type})}/>
                <Button variant="outline" size="icon" aria-label="Edit, for example to mark it as a transfer" onClick={() => setEditing(true)}>
                    <Pencil/>
                </Button>
            </div>

            {item.sameMerchant > 0 && (
                <label className="flex items-center justify-between gap-2 rounded-2xl bg-secondary px-3 py-2 text-sm font-semibold">
                    Also sort {item.sameMerchant} more from this place
                    <Switch checked={applyToMerchant} onCheckedChange={setApplyToMerchant}/>
                </label>
            )}
            <TransactionSheet open={editing} onOpenChange={setEditing} transaction={item}/>
        </Card>
    );
}

export default ReviewPage;
