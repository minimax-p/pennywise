import React, {ReactNode} from "react";
import {cn} from "@/lib/utils";

// The title row at the top of each page
function PageHeader({title, subtitle, actions, className}: {
    title: ReactNode, subtitle?: ReactNode, actions?: ReactNode, className?: string
}) {
    return (
        <div className={cn("container flex flex-wrap items-end justify-between gap-3 pb-2 pt-4 md:pt-8", className)}>
            <div className="min-w-0">
                <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
                {subtitle && <p className="mt-1 text-muted-foreground">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

export default PageHeader;
