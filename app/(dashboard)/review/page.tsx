'use client';

import React, {useState} from 'react';
import Link from "next/link";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {CheckCheck, Loader2, Pencil, Sparkles} from "lucide-react";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Checkbox} from "@/components/ui/checkbox";
import CategoryPicker from "@/app/(dashboard)/_components/CategoryPicker";
import EditTransactionDialog from "@/app/(dashboard)/transactions/_components/EditTransactionDialog";
import {AcceptSuggestions, AskAiToSort, SortTransaction} from "@/app/(dashboard)/_actions/review";
import type {GetReviewQueueResponseType} from "@/app/api/review/route";
import {TransactionType} from "@/lib/types";
import {cn} from "@/lib/utils";

type ReviewItem = GetReviewQueueResponseType["items"][number];

const dayFormatter = new Intl.DateTimeFormat(undefined, {timeZone: 'UTC', month: 'short', day: 'numeric'});

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

function useAfterSorting() {
    const queryClient = useQueryClient();
    return () => Promise.all(['review', 'transactions', 'overview'].map((key) =>
        queryClient.invalidateQueries({queryKey: [key]})));
}

function ReviewPage() {
    const queue = useReviewQueue();
    const afterSorting = useAfterSorting();
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
        onSettled: afterSorting,
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
        onSettled: afterSorting,
    });

    return (
        <>
            <div className='border-b bg-card'>
                <div className='container flex flex-wrap items-center justify-between gap-4 py-8'>
                    <div>
                        <p className='text-3xl font-bold'>Sort transactions</p>
                        <p className='text-muted-foreground'>
                            {queue.isLoading ? "Loading..." : queue.data?.total
                                ? `${queue.data.total} to check. Tap the right category.`
                                : "Everything is sorted."}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {queue.data?.aiEnabled && notAskedYet > 0 && (
                            <Button variant="outline" className="gap-2" disabled={askAi.isPending} onClick={() => askAi.mutate()}>
                                {askAi.isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Sparkles className="h-4 w-4"/>}
                                Ask Jev about {notAskedYet}
                            </Button>
                        )}
                        {withSuggestion.length > 0 && (
                            <Button className="gap-2" disabled={acceptAll.isPending} onClick={() => acceptAll.mutate()}>
                                {acceptAll.isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <CheckCheck className="h-4 w-4"/>}
                                Keep all {withSuggestion.length} suggestions
                            </Button>
                        )}
                    </div>
                </div>
            </div>
            <div className='container flex flex-col gap-3 py-6'>
                {queue.data && !queue.data.aiEnabled && items.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                        Tip: with a TypeSafe API key (TYPESAFE_API_KEY in the server&apos;s .env), Jev suggests categories
                        for merchants you haven&apos;t sorted before.
                    </p>
                )}
                <SkeletonWrapper isLoading={queue.isLoading}>
                    {items.length === 0 ? (
                        <Card className="flex flex-col items-center gap-2 p-10 text-center">
                            <CheckCheck className="h-10 w-10 text-emerald-500"/>
                            <p className="text-lg font-semibold">All sorted</p>
                            <p className="text-sm text-muted-foreground">
                                New transactions that need a category show up here. <Link href="/transactions" className="underline">See all transactions</Link>
                            </p>
                        </Card>
                    ) : (
                        <div className="flex flex-col gap-3">
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
    const [showAll, setShowAll] = useState(false);
    const queryClient = useQueryClient();
    const afterSorting = useAfterSorting();

    const sort = useMutation({
        mutationFn: (category: string) => SortTransaction({id: item.id, category, applyToMerchant: applyToMerchant && item.sameMerchant > 0}),
        onSuccess: (response, category) => {
            if (!response.ok) {
                toast.error(response.error);
                return;
            }
            // Drop the sorted cards right away; the refetch confirms
            queryClient.setQueryData<GetReviewQueueResponseType>(['review', 'queue'], (data) => data && {
                ...data,
                total: Math.max(0, data.total - response.data.sorted),
                items: data.items.filter((i) => i.id !== item.id),
            });
            if (response.data.sorted > 1) toast.success(`Sorted ${response.data.sorted} transactions as ${category}`);
        },
        onError: () => toast.error("Could not save"),
        onSettled: afterSorting,
    });

    const income = item.type === "income";

    return (
        <Card className={cn("flex flex-col gap-3 p-4", sort.isPending && "opacity-60")}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate font-semibold">{item.description || "(no description)"}</p>
                    <p className="text-sm text-muted-foreground">
                        {[dayFormatter.format(new Date(item.date)), item.accountName, item.source ?? SOURCE_LABELS[item.entrySource]]
                            .filter(Boolean).join(" · ")}
                    </p>
                </div>
                <span className={cn("whitespace-nowrap font-mono", income ? "text-sky-500" : "text-amber-500")}>
                    {income ? "+" : "-"}{item.formattedAmount}
                </span>
            </div>

            <div className="flex flex-wrap gap-2">
                {item.choices.map((choice, index) => (
                    <Button key={choice.name} size="sm" disabled={sort.isPending}
                            variant={index === 0 && item.category.name !== "Unsorted" ? "default" : "secondary"}
                            className="gap-1" onClick={() => sort.mutate(choice.name)}>
                        <span role="img">{choice.icon}</span>
                        {choice.name}
                        {choice.probability !== null && (
                            <span className="text-xs opacity-70">{Math.round(choice.probability * 100)}%</span>
                        )}
                    </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Fewer" : "Other category"}
                </Button>
                <EditTransactionDialog transaction={item} trigger={
                    <Button size="sm" variant="ghost" className="gap-1" aria-label="Edit, e.g. mark as a transfer">
                        <Pencil className="h-3 w-3"/>Edit
                    </Button>
                }/>
            </div>

            {showAll && (
                <div className="max-w-sm">
                    <CategoryPicker type={item.type as TransactionType} onChange={(category) => sort.mutate(category)}/>
                </div>
            )}

            {item.sameMerchant > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox checked={applyToMerchant} onCheckedChange={(checked) => setApplyToMerchant(checked === true)}/>
                    Also sort {item.sameMerchant} more from this merchant
                </label>
            )}
        </Card>
    );
}

export default ReviewPage;
