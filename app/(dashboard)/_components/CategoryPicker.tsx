"use client";

import React, {ReactNode, useState} from 'react';
import {useQuery} from "@tanstack/react-query";
import {Category} from "@prisma/client";
import {Check, ChevronsUpDown} from "lucide-react";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Button} from "@/components/ui/button";
import {Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList} from "@/components/ui/command";
import CreateCategoryDialog from "@/app/(dashboard)/_components/CreateCategoryDialog";
import {TransactionType} from "@/lib/types";
import {cn} from "@/lib/utils";

export type PickedCategory = { name: string, type: TransactionType };

export function useAllCategories() {
    return useQuery<Category[]>({
        queryKey: ['categories', 'all'],
        queryFn: () => fetch('/api/categories').then((res) => res.json()),
    });
}

interface Props {
    // Which way the money went: money in can also be money back in a spending category
    kind: TransactionType;
    value: PickedCategory | null;
    onChange: (value: PickedCategory) => void;
    // Replaces the full-width button, e.g. with a "More…" chip
    trigger?: ReactNode;
}

function CategoryPicker({kind, value, onChange, trigger}: Props) {
    const [open, setOpen] = useState(false);
    const categoriesQuery = useAllCategories();
    const categories = Array.isArray(categoriesQuery.data) ? categoriesQuery.data : [];
    const selected = value && categories.find((c) => c.name === value.name && c.type === value.type);
    // Hidden ones aren't offered, unless one is already picked
    const offered = (type: TransactionType) => categories.filter((c) => c.type === type && c.name !== "Unsorted"
        && (!c.hidden || (value?.name === c.name && value.type === c.type)));

    // Spending by its groups; money in by its groups, then spending categories as money back
    const byGroup = (type: TransactionType, prefix = "") => {
        const groups = new Map<string, Category[]>();
        for (const c of offered(type)) {
            const heading = prefix + (c.group ?? (type === "income" ? "Income" : "Other"));
            groups.set(heading, [...(groups.get(heading) ?? []), c]);
        }
        return [...groups.entries()].map(([heading, list]) => ({heading, type, list}));
    };
    const groups = kind === "expense"
        ? byGroup("expense")
        : [...byGroup("income"), {heading: "Money back (refund or payback)", type: "expense" as TransactionType, list: offered("expense")}];

    const pick = (category: { name: string, type: string }) => {
        onChange({name: category.name, type: category.type as TransactionType});
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={setOpen} modal={true}>
            <PopoverTrigger asChild>
                {trigger ?? <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-semibold">
                    {selected ? (
                        <span className="flex min-w-0 items-center gap-2">
                            <span role="img" className="text-lg">{selected.icon}</span>
                            <span className="truncate">{selected.name}</span>
                            {kind === "income" && selected.type === "expense" && (
                                <span className="rounded-full bg-spend-soft px-2 py-0.5 text-[11px] font-bold text-spend-ink">money back</span>
                            )}
                        </span>
                    ) : <span className="text-muted-foreground">Pick a category</span>}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50"/>
                </Button>}
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[280px] rounded-3xl border-2 p-0" align="start">
                <Command className="rounded-3xl">
                    <CommandInput placeholder="Search categories..."/>
                    <CreateCategoryDialog type={kind} successCallBack={pick}/>
                    <CommandList className="max-h-[320px]">
                        <CommandEmpty>No category by that name. Create one above.</CommandEmpty>
                        {groups.map((group) => (
                            <CommandGroup key={group.heading} heading={group.heading}>
                                {group.list.map((category) => (
                                    <CommandItem key={category.id} value={`${category.name} ${group.type}`}
                                                 onSelect={() => pick(category)} className="gap-2 rounded-xl py-2">
                                        <span role="img" className="text-lg">{category.icon}</span>
                                        <span className="flex-1">{category.name}</span>
                                        <Check className={cn("h-4 w-4 text-primary opacity-0",
                                            value?.name === category.name && value.type === group.type && "opacity-100")}/>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

export default CategoryPicker;
