'use client';

import React from 'react';
import Link from "next/link";
import {useQuery} from "@tanstack/react-query";
import {ArrowRight, Tags} from "lucide-react";

// Nudge on the dashboard when transactions are waiting to be sorted
function ReviewBanner() {
    const {data} = useQuery<{ count: number }>({
        queryKey: ['review', 'count'],
        queryFn: () => fetch('/api/review/count').then((res) => res.json()),
    });
    if (!data?.count) return null;

    return (
        <div className="container pt-6">
            <Link href="/review"
                  className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-400/10 p-4 hover:bg-amber-400/20">
                <span className="flex items-center gap-3">
                    <Tags className="h-5 w-5 text-amber-500"/>
                    {data.count} {data.count === 1 ? "transaction needs" : "transactions need"} a category
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold">Sort now <ArrowRight className="h-4 w-4"/></span>
            </Link>
        </div>
    );
}

export default ReviewBanner;
