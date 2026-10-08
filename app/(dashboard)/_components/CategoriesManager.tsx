'use client';

import React, {ReactNode, useEffect, useState} from 'react';
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {Category} from "@prisma/client";
import {toast} from "sonner";
import {EyeOff, Loader2, Plus} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Switch} from "@/components/ui/switch";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from "@/components/ui/dialog";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {useAllCategories} from "@/app/(dashboard)/_components/CategoryPicker";
import {CreateCategory, MergeCategory, UpdateCategory} from "@/app/(dashboard)/_actions/categories";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";
import {SYSTEM_KEYS} from "@/prisma/categories.mjs";
import {TransactionType} from "@/lib/types";
import {cn} from "@/lib/utils";

const isSystem = (c: Category) => Boolean(c.key && (SYSTEM_KEYS as readonly string[]).includes(c.key));

// Your categories by group, to rename, regroup, hide or merge
function CategoriesManager({type}: { type: TransactionType }) {
    const query = useAllCategories();
    const all = Array.isArray(query.data) ? query.data : [];
    const categories = all.filter((c) => c.type === type && !isSystem(c));
    const groups = new Map<string, Category[]>();
    for (const c of categories) {
        const heading = c.group ?? (type === "income" ? "Income" : "Other");
        groups.set(heading, [...(groups.get(heading) ?? []), c]);
    }
    const groupNames = [...new Set(all.map((c) => c.group).filter((g): g is string => Boolean(g)))];

    return (
        <div className="flex flex-col gap-4 text-sm">
            {[...groups.entries()].map(([heading, list]) => (
                <div key={heading} className="flex flex-col gap-2">
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{heading}</h3>
                    <div className="flex flex-wrap gap-2">
                        {list.map((category) => (
                            <CategoryDialog key={category.id} category={category} type={type} groups={groupNames} siblings={categories}
                                            trigger={
                                                <button type="button" className={cn(
                                                    "flex items-center gap-1.5 rounded-full border-2 bg-card px-3 py-1.5 font-bold hover:bg-accent",
                                                    category.hidden && "border-dashed text-muted-foreground")}>
                                                    <span role="img" aria-hidden>{category.icon}</span>{category.name}
                                                    {category.hidden && <EyeOff className="h-3.5 w-3.5"/>}
                                                </button>
                                            }/>
                        ))}
                    </div>
                </div>
            ))}
            <div>
                <CategoryDialog type={type} groups={groupNames} siblings={categories}
                                trigger={<Button variant="outline"><Plus/>New category</Button>}/>
            </div>
        </div>
    );
}

function CategoryDialog({category, type, groups, siblings, trigger}: {
    category?: Category, type: TransactionType, groups: string[], siblings: Category[], trigger: ReactNode,
}) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [icon, setIcon] = useState("");
    const [group, setGroup] = useState("");
    const [hidden, setHidden] = useState(false);
    const [mergeInto, setMergeInto] = useState("");
    const queryClient = useQueryClient();
    const invalidate = useInvalidateMoney();

    useEffect(() => {
        if (!open) return;
        setName(category?.name ?? "");
        setIcon(category?.icon ?? "");
        setGroup(category?.group ?? "");
        setHidden(category?.hidden ?? false);
        setMergeInto("");
    }, [open, category]);

    const done = async (message: string) => {
        toast.success(message);
        setOpen(false);
        await Promise.all([queryClient.invalidateQueries({queryKey: ['categories']}), invalidate()]);
    };

    const save = useMutation({
        mutationFn: async () => {
            if (!category) {
                await CreateCategory({name, icon, type, group});
                return;
            }
            const response = await UpdateCategory({id: category.id, name, icon, group, hidden});
            if (!response.ok) throw new Error(response.error);
        },
        onSuccess: () => done(category ? "Saved" : `Added ${name}`),
        onError: (e) => toast.error(e instanceof Error && e.message ? e.message : "Could not save"),
    });
    const merge = useMutation({
        mutationFn: async () => {
            const response = await MergeCategory({fromId: category!.id, intoId: mergeInto});
            if (!response.ok) throw new Error(response.error);
            return response.data.moved;
        },
        onSuccess: (moved) => done(`Merged; ${moved} ${moved === 1 ? "transaction" : "transactions"} moved`),
        onError: (e) => toast.error(e.message),
    });

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                    <DialogTitle>{category ? `${category.icon} ${category.name}` : type === "income" ? "New money-in category" : "New spending category"}</DialogTitle>
                    <DialogDescription>
                        {category ? "Rename it, move it to another group, or hide it. Transactions keep it either way." : "Shown when you pick a category."}
                    </DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate();
                }}>
                    <div className="grid grid-cols-[4.5rem_1fr] gap-3">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="category-icon">Emoji</Label>
                            <Input id="category-icon" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8}
                                   className="text-center text-xl" placeholder="🙂"/>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="category-name">Name</Label>
                            <Input id="category-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40}/>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="category-group">Group</Label>
                        <Input id="category-group" value={group} onChange={(e) => setGroup(e.target.value)} maxLength={40}
                               list="category-groups" placeholder="e.g. Food"/>
                        <datalist id="category-groups">{groups.map((g) => <option key={g} value={g}/>)}</datalist>
                    </div>
                    {category && (
                        <label className="flex items-center justify-between gap-2 rounded-2xl bg-secondary px-3 py-2 text-sm font-semibold">
                            Hide it from the lists
                            <Switch checked={hidden} onCheckedChange={setHidden}/>
                        </label>
                    )}
                    <DialogFooter>
                        <Button type="submit" disabled={save.isPending || !name.trim() || !icon.trim()}>
                            {save.isPending ? <Loader2 className="animate-spin"/> : category ? "Save" : "Add"}
                        </Button>
                    </DialogFooter>
                </form>
                {category && (
                    <div className="flex flex-col gap-2 border-t-2 pt-4">
                        <Label>Merge into another category</Label>
                        <div className="flex gap-2">
                            <Select value={mergeInto} onValueChange={setMergeInto}>
                                <SelectTrigger><SelectValue placeholder="Pick one…"/></SelectTrigger>
                                <SelectContent>
                                    {siblings.filter((c) => c.id !== category.id).map((c) => (
                                        <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button type="button" variant="outline" disabled={!mergeInto || merge.isPending} onClick={() => merge.mutate()}>
                                {merge.isPending ? <Loader2 className="animate-spin"/> : "Merge"}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">Its transactions, split parts and rules move over, and {category.name} goes away.</p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

export default CategoriesManager;
