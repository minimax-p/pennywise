'use client';

import React, {useEffect, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {Category, UserSettings} from "@prisma/client";
import {toast} from "sonner";
import {Loader2, Plus} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import SkeletonWrapper from "@/components/SkeletonWrapper";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {CurrencyComboBox} from "@/components/CurrencyComboBox";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {TransactionType} from "@/lib/types";
import CreateCategoryDialog from "@/app/(dashboard)/_components/CreateCategoryDialog";
import DeleteCategoryDialog from "@/app/(dashboard)/_components/DeleteCategoryDialog";
import EditCategoryDialog from "@/app/(dashboard)/_components/EditCategoryDialog";
import LinkedAccounts from "@/app/(dashboard)/_components/LinkedAccounts";
import AccountsManager from "@/app/(dashboard)/_components/AccountsManager";
import ApplePayShortcut from "@/app/(dashboard)/_components/ApplePayShortcut";
import {ConvertSelfZelle, UpdateSelfNames} from "@/app/(dashboard)/_actions/settings";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";

function Page() {
    const userSettingsQuery = useQuery<UserSettings>({
        queryKey: ["userSettings"],
        queryFn: () => fetch("/api/user-settings").then((res) => res.json()),
    });
    const currency = userSettingsQuery.data?.currency ?? "USD";

    return (
        <>
            <PageHeader title="Manage" subtitle="Accounts, your name at the bank, the Apple Pay shortcut and categories"/>
            <div className='container flex flex-col gap-4 py-3'>
                <Card>
                    <CardHeader>
                        <CardTitle>Accounts</CardTitle>
                        <CardDescription>Every bank account, card, CD and cash you use. Open one to check its balance with the bank.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <AccountsManager currency={currency}/>
                    </CardContent>
                </Card>
                <SelfNamesCard settings={userSettingsQuery.data}/>
                <Card>
                    <CardHeader>
                        <CardTitle>Apple Pay shortcut</CardTitle>
                        <CardDescription>Log Apple Pay purchases automatically as you pay</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ApplePayShortcut/>
                    </CardContent>
                </Card>
                <LinkedAccounts/>
                <Card>
                    <CardHeader>
                        <CardTitle>Currency</CardTitle>
                        <CardDescription>Used for every amount</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <CurrencyComboBox/>
                    </CardContent>
                </Card>
                <CategoryList type='expense'/>
                <CategoryList type='income'/>
            </div>
        </>
    );
}

// How the bank prints your name, so Zelle payments to and from yourself are transfers
function SelfNamesCard({settings}: { settings?: UserSettings }) {
    const [value, setValue] = useState("");
    const queryClient = useQueryClient();
    const invalidate = useInvalidateMoney();
    useEffect(() => {
        setValue(settings?.selfNames ?? "");
    }, [settings?.selfNames]);

    // Past Zelle payments to yourself still saved as spending or income
    const pending = useQuery({
        queryKey: ['self-zelle', settings?.selfNames],
        queryFn: async () => {
            const response = await ConvertSelfZelle(true);
            return response.ok ? response.data : {converted: 0, skipped: 0};
        },
        enabled: Boolean(settings?.selfNames),
    });
    const convert = useMutation({
        mutationFn: () => ConvertSelfZelle(false),
        onSuccess: async (response) => {
            if (!response.ok) {
                toast.error(response.error);
                return;
            }
            toast.success(`Turned ${response.data.converted} Zelle payments into transfers`);
            await Promise.all([invalidate(), pending.refetch()]);
        },
        onError: () => toast.error("Could not change them"),
    });

    const save = useMutation({
        mutationFn: () => UpdateSelfNames(value),
        onSuccess: async (response) => {
            if (!response.ok) {
                toast.error(response.error);
                return;
            }
            toast.success("Saved");
            await queryClient.invalidateQueries({queryKey: ["userSettings"]});
        },
        onError: () => toast.error("Could not save"),
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle>Your name at the bank</CardTitle>
                <CardDescription>
                    When you Zelle money to your own account at another bank, the statement says something like
                    &ldquo;Zelle payment to <b>YOUR NAME</b>&rdquo;. With your name here, those lines are imported as moves
                    between your accounts instead of spending. Separate several spellings with commas.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate();
                }}>
                    <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={191}
                           placeholder="e.g. Huu Nhat Minh Pham" aria-label="Your name as banks print it"/>
                    <Button type="submit" disabled={save.isPending || value === (settings?.selfNames ?? "")}>
                        {save.isPending ? <Loader2 className="animate-spin"/> : "Save"}
                    </Button>
                </form>
                {pending.data && pending.data.converted > 0 && (
                    <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-sun-soft p-3 text-sm font-semibold sm:flex-row sm:items-center">
                        <span className="flex-1">
                            {pending.data.converted} Zelle {pending.data.converted === 1 ? "payment" : "payments"} with yourself
                            {pending.data.converted === 1 ? " is" : " are"} still counted as spending or income.
                        </span>
                        <Button size="sm" disabled={convert.isPending} onClick={() => convert.mutate()}>
                            {convert.isPending ? <Loader2 className="animate-spin"/> : "Make them transfers"}
                        </Button>
                    </div>
                )}
                {pending.data && pending.data.skipped > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                        {pending.data.skipped} more could go to more than one account, or already have their other side
                        saved there. Edit those by hand and choose Moved.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

function CategoryList({type}: { type: TransactionType }) {
    const categoriesQuery = useQuery<Category[]>({
        queryKey: ['categories', type],
        queryFn: () => fetch(`/api/categories?type=${type}`).then(res => res.json())
    });
    const categories = Array.isArray(categoriesQuery.data) ? categoriesQuery.data : [];

    return (
        <SkeletonWrapper isLoading={categoriesQuery.isLoading}>
            <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
                    <div>
                        <CardTitle>{type === 'income' ? 'Income categories' : 'Spending categories'}</CardTitle>
                        <CardDescription>Built-in ones can&apos;t be changed. Yours can be renamed or removed.</CardDescription>
                    </div>
                    <CreateCategoryDialog type={type} successCallBack={() => categoriesQuery.refetch()}
                                          trigger={<Button variant="outline"><Plus/>New</Button>}/>
                </CardHeader>
                <CardContent>
                    {categories.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No {type === "income" ? "income" : "spending"} categories yet.</p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {categories.map((category) => <CategoryChip key={category.id} category={category}/>)}
                        </div>
                    )}
                </CardContent>
            </Card>
        </SkeletonWrapper>
    );
}

function CategoryChip({category}: { category: Category }) {
    const chip = (
        <span className="flex items-center gap-1.5 rounded-full border-2 bg-card px-3 py-1.5 text-sm font-bold">
            <span role="img">{category.icon}</span>{category.name}
        </span>
    );
    if (category.isUniversal) return chip;
    return (
        <span className="flex items-center gap-1 rounded-full border-2 border-primary/40 bg-primary-soft py-1 pl-3 pr-1 text-sm font-bold">
            <span role="img">{category.icon}</span>{category.name}
            <EditCategoryDialog category={category} trigger={<Button variant="ghost" size="sm" className="h-7 px-2">Edit</Button>}/>
            <DeleteCategoryDialog category={category} trigger={<Button variant="ghost" size="sm" className="h-7 px-2 text-destructive">Remove</Button>}/>
        </span>
    );
}

export default Page;
