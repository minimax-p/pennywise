'use client';

import React, {ReactNode, useState} from 'react';
import {useQuery} from "@tanstack/react-query";
import {Check, UserPlus} from "lucide-react";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList} from "@/components/ui/command";
import type {GetPeopleResponseType} from "@/app/api/people/route";
import {cn} from "@/lib/utils";

// Someone already in Pennywise, or a name typed for someone new
export type PersonValue = { id: string, name: string } | { name: string };

export function usePeople() {
    return useQuery<GetPeopleResponseType>({
        queryKey: ['people'],
        queryFn: () => fetch('/api/people').then((res) => res.json()),
    });
}

export function initials(name: string) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

export function Avatar({name, className}: { name: string, className?: string }) {
    return (
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full bg-move-soft text-xs font-extrabold text-move-ink", className)} aria-hidden>
            {initials(name)}
        </span>
    );
}

// Pick a person, or type a new name. People who owe you or you owe come first.
export function PersonCombobox({value, onChange, trigger, placeholder = "Who?"}: {
    value: PersonValue | null,
    onChange: (value: PersonValue) => void,
    trigger?: ReactNode,
    placeholder?: string,
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const {data} = usePeople();
    const people = data?.people ?? [];
    const typed = search.trim();
    const exists = people.some((p) => p.name.toLowerCase() === typed.toLowerCase());

    const pick = (next: PersonValue) => {
        onChange(next);
        setOpen(false);
        setSearch("");
    };

    return (
        <Popover open={open} onOpenChange={setOpen} modal={true}>
            <PopoverTrigger asChild>
                {trigger ?? (
                    <button type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border-2 bg-card px-3 py-2 text-left text-sm font-bold">
                        {value ? <><Avatar name={value.name} className="h-6 w-6 text-[10px]"/><span className="truncate">{value.name}</span></>
                            : <span className="text-muted-foreground">{placeholder}</span>}
                    </button>
                )}
            </PopoverTrigger>
            <PopoverContent className="w-[min(320px,calc(100vw-2rem))] rounded-3xl border-2 p-0" align="start">
                <Command className="rounded-3xl">
                    <CommandInput placeholder="Name" value={search} onValueChange={setSearch}/>
                    <CommandList className="max-h-[280px]">
                        <CommandEmpty>{typed ? "No one by that name yet." : "No people yet. Type a name."}</CommandEmpty>
                        {typed && !exists && (
                            <CommandGroup>
                                <CommandItem value={`new ${typed}`} onSelect={() => pick({name: typed})} className="gap-2 rounded-xl py-2">
                                    <UserPlus className="h-4 w-4 text-primary"/>Add &ldquo;{typed}&rdquo;
                                </CommandItem>
                            </CommandGroup>
                        )}
                        <CommandGroup heading="People">
                            {people.map((person) => (
                                <CommandItem key={person.id} value={`${person.name} ${person.aliases.join(" ")}`}
                                             onSelect={() => pick({id: person.id, name: person.name})} className="gap-2 rounded-xl py-2">
                                    <Avatar name={person.name} className="h-7 w-7 text-[10px]"/>
                                    <span className="flex-1 truncate">{person.name}</span>
                                    {person.balance > 0 && <span className="text-xs font-bold text-income-ink money">owes {person.balance.toFixed(2)}</span>}
                                    {person.balance < 0 && <span className="text-xs font-bold text-spend-ink money">you owe {(-person.balance).toFixed(2)}</span>}
                                    <Check className={cn("h-4 w-4 text-primary opacity-0", value && "id" in value && value.id === person.id && "opacity-100")}/>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
