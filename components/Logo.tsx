import React from "react";
import Link from "next/link";
import PennyMark from "@/components/PennyMark";
import {cn} from "@/lib/utils";

function Logo({className, compact}: { className?: string, compact?: boolean }) {
    return (
        <Link href="/" className={cn("flex items-center gap-2", className)} aria-label="Pennywise home">
            <PennyMark className={compact ? "h-8 w-8" : "h-10 w-10"}/>
            <span className={cn("font-display font-bold tracking-tight text-foreground", compact ? "text-xl" : "text-2xl")}>
                Pennywise
            </span>
        </Link>
    );
}

export default Logo;
