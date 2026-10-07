'use client';

import React, {Suspense, useEffect, useMemo, useState} from 'react';
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {useQuery} from "@tanstack/react-query";
import {toast} from "sonner";
import {Category, UserSettings} from "@prisma/client";
import {AlertTriangle, CheckCircle2, FileUp, Loader2, Settings2, StickyNote} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Checkbox} from "@/components/ui/checkbox";
import {Switch} from "@/components/ui/switch";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import AccountPicker, {useAccounts, useRememberedAccount} from "@/app/(dashboard)/_components/AccountPicker";
import {useAllCategories} from "@/app/(dashboard)/_components/CategoryPicker";
import {useCurrencyFormatter} from "@/app/(dashboard)/_components/TransactionSheet";
import {CommitImport, ImportPreview, PreviewImport} from "@/app/(dashboard)/import/actions";
import type {CommitResult, PlanRow, PlanStatus} from "@/lib/import/plan";
import type {ColumnMapping} from "@/lib/import/parse";
import {useInvalidateMoney} from "@/lib/client/useInvalidateMoney";
import {fullDayFormatter} from "@/lib/money";
import {cn} from "@/lib/utils";

const STATUS_LABELS: Record<PlanStatus, string> = {
    new: "New",
    duplicate: "Already in",
    match: "Matched",
    transfer: "Transfer",
    pair: "Transfer",
    skip: "Skipped",
};

const STATUS_STYLES: Record<PlanStatus, string> = {
    new: "bg-primary-soft text-primary",
    duplicate: "bg-secondary text-muted-foreground",
    match: "bg-income-soft text-income-ink",
    transfer: "bg-move-soft text-move-ink",
    pair: "bg-move-soft text-move-ink",
    skip: "bg-secondary text-muted-foreground",
};

const NONE = "__none";

function ImportView() {
    const params = useSearchParams();
    const [rememberedAccount, setAccountId] = useRememberedAccount('pennywise:import-account');
    const accountId = params.get("account") && !rememberedAccount ? params.get("account") : rememberedAccount;
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [rows, setRows] = useState<PlanRow[]>([]);
    const [busy, setBusy] = useState(false);
    const [showColumns, setShowColumns] = useState(false);
    const [result, setResult] = useState<CommitResult | null>(null);
    const invalidate = useInvalidateMoney();
    const formatter = useCurrencyFormatter();
    const accountsQuery = useAccounts();
    const accounts = Array.isArray(accountsQuery.data) ? accountsQuery.data : [];
    const account = accounts.find((a) => a.id === accountId);
    const settings = useQuery<UserSettings>({
        queryKey: ["userSettings"],
        queryFn: () => fetch("/api/user-settings").then((res) => res.json()),
    });

    // Coming from an account page picks that account
    useEffect(() => {
        const fromPage = params.get("account");
        if (fromPage) setAccountId(fromPage);
    }, [params, setAccountId]);

    const loadPreview = async (mapping?: ColumnMapping) => {
        if (!accountId || !file) return;
        setBusy(true);
        setResult(null);
        try {
            const formData = new FormData();
            formData.set("accountId", accountId);
            formData.set("file", file);
            if (mapping) formData.set("mapping", JSON.stringify(mapping));
            const response = await PreviewImport(formData);
            if (!response.ok) {
                toast.error(response.error);
                return;
            }
            setPreview(response.data);
            setRows(response.data.rows);
        } catch {
            toast.error("Could not read that file");
        } finally {
            setBusy(false);
        }
    };

    const commit = async () => {
        if (!accountId || !preview) return;
        setBusy(true);
        try {
            const response = await CommitImport({accountId, rows, mapping: preview.mapping, balances: preview.balances});
            if (!response.ok) {
                toast.error(response.error);
                return;
            }
            const {created, linked} = response.data;
            toast.success(`Imported ${created} new${linked ? ` and matched ${linked}` : ""} 🎉`);
            setResult(response.data);
            setPreview(null);
            setRows([]);
            setFile(null);
            await invalidate();
        } catch {
            toast.error("Import failed");
        } finally {
            setBusy(false);
        }
    };

    const updateRow = (index: number, change: Partial<PlanRow>) =>
        setRows((current) => current.map((row, i) => i === index ? {...row, ...change} : row));

    const counts = useMemo(() => {
        const included = rows.filter((r) => r.include);
        return {
            included: included.length,
            newRows: included.filter((r) => !r.linkTransactionId).length,
            linked: included.filter((r) => r.linkTransactionId).length,
            duplicates: rows.filter((r) => r.status === "duplicate").length,
            // Transfers need the other account before they can be saved
            unplaced: included.filter((r) => !r.linkTransactionId && r.kind === "transfer" && !r.transferAccountId).length,
            zelle: rows.filter((r) => /\bzelle\b/i.test(r.description)).length,
        };
    }, [rows]);
    const closing = preview?.balances.length ? preview.balances[preview.balances.length - 1] : null;

    return (
        <>
            <PageHeader title="Import" subtitle="Add transactions from a file your bank gives you"/>
            <div className="container flex flex-col gap-4 py-3">
                {result && <ImportResult result={result} accountId={accountId} formatter={formatter}/>}

                {accounts.length === 0 && !accountsQuery.isLoading ? (
                    <Card className="p-6 text-sm font-semibold">
                        First <Link href="/manage" className="text-primary underline">add the account</Link> the statement belongs to.
                    </Card>
                ) : (
                    <Card>
                        <CardHeader>
                            <CardTitle>Choose a file</CardTitle>
                            <CardDescription>
                                CSV, QFX or OFX. Lines already imported are skipped, and anything you logged by hand or
                                through Apple Pay is matched instead of doubled.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                                <div className="flex flex-col gap-2">
                                    <Label>Account</Label>
                                    <AccountPicker value={accountId} onChange={(id) => {
                                        setAccountId(id);
                                        setPreview(null);
                                    }}/>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="statement-file">Statement file</Label>
                                    <Input id="statement-file" type="file" accept=".csv,.ofx,.qfx,.qbo,.txt" className="pt-2"
                                           onChange={(e) => {
                                               setFile(e.target.files?.[0] ?? null);
                                               setPreview(null);
                                           }}/>
                                </div>
                                <Button onClick={() => loadPreview()} disabled={!accountId || !file || busy}>
                                    {busy && !preview ? <Loader2 className="animate-spin"/> : <FileUp/>}
                                    Preview
                                </Button>
                            </div>
                            <details className="text-sm text-muted-foreground">
                                <summary className="cursor-pointer font-bold">Where to download statements</summary>
                                <ul className="mt-2 list-disc space-y-1 pl-5">
                                    <li><b>Chase:</b> open the account, choose Download account activity, then Spreadsheet (CSV) or Quicken (QFX). The CSV includes the balance, so Pennywise can check every day.</li>
                                    <li><b>Discover:</b> Activity, then Download, then CSV or Quicken (QFX).</li>
                                    <li><b>Capital One 360:</b> open the account, choose Download Transactions, then CSV or QFX.</li>
                                    <li><b>Venmo:</b> Statements on venmo.com, then Download CSV. Payments funded from your bank card are skipped because they appear on that card&apos;s statement.</li>
                                </ul>
                            </details>
                        </CardContent>
                    </Card>
                )}

                {preview && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Check {rows.length} lines</CardTitle>
                            <CardDescription>
                                {counts.newRows} new, {counts.linked} matched to transactions you already have, {counts.duplicates} already
                                imported. {preview.detected ? `Format: ${preview.detected}.` : ""}
                                {preview.skippedLines > 0 && ` ${preview.skippedLines} lines without a date or amount were ignored.`}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                            {closing && (
                                <p className="flex items-center gap-2 rounded-2xl bg-primary-soft px-3 py-2 text-sm font-bold">
                                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary"/>
                                    The statement shows {formatter.format(closing.balance)} on {fullDayFormatter.format(new Date(closing.date))}.
                                    Pennywise saves its balances and checks every day after importing.
                                </p>
                            )}
                            {counts.zelle > 0 && !settings.data?.selfNames && (
                                <p className="rounded-2xl bg-sun-soft px-3 py-2 text-sm font-semibold">
                                    Moving money to yourself with Zelle? Add your name as the bank prints it on
                                    the <Link href="/manage" className="font-bold underline">Manage</Link> page, and those lines become transfers.
                                </p>
                            )}
                            {preview.format === "csv" && preview.mapping && (
                                <div>
                                    <Button variant="outline" size="sm" onClick={() => setShowColumns((v) => !v)}>
                                        <Settings2/>{showColumns ? "Hide columns" : "Wrong amounts or dates? Change columns"}
                                    </Button>
                                    {showColumns && (
                                        <ColumnEditor headers={preview.headers} mapping={preview.mapping} busy={busy}
                                                      onApply={(mapping) => loadPreview(mapping)}/>
                                    )}
                                </div>
                            )}
                            <label className="flex items-center gap-2 px-1 text-sm font-bold">
                                <Checkbox checked={rows.length > 0 && rows.every((r) => r.include || r.status === "duplicate")}
                                          onCheckedChange={(checked) => setRows((current) =>
                                              current.map((r) => ({...r, include: checked === true && r.status !== "duplicate"})))}/>
                                Include all new lines
                            </label>
                            <div className="flex flex-col divide-y-2 rounded-3xl border-2">
                                {rows.map((row, index) => (
                                    <PreviewRow key={row.fingerprint + index} row={row} accountId={accountId}
                                                onChange={(change) => updateRow(index, change)}/>
                                ))}
                            </div>
                            {counts.unplaced > 0 && (
                                <p className="flex items-center gap-2 rounded-2xl bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">
                                    <AlertTriangle className="h-4 w-4 shrink-0"/>
                                    Pick the other account for {counts.unplaced} {counts.unplaced === 1 ? "transfer" : "transfers"}, or untick {counts.unplaced === 1 ? "it" : "them"}.
                                </p>
                            )}
                            <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] flex flex-wrap items-center justify-end gap-2 rounded-3xl bg-card/95 py-2 backdrop-blur md:bottom-2">
                                <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>Cancel</Button>
                                <Button size="lg" onClick={commit} disabled={busy || counts.included === 0 || counts.unplaced > 0}>
                                    {busy && <Loader2 className="animate-spin"/>}
                                    Import {counts.included} {counts.included === 1 ? "line" : "lines"}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}
                {account && !preview && (
                    <p className="text-center text-sm font-semibold text-muted-foreground">
                        <Link href={`/accounts/${account.id}`} className="text-primary">Open {account.name}</Link> to see its balance checks.
                    </p>
                )}
            </div>
        </>
    );
}

function ImportResult({result, accountId, formatter}: { result: CommitResult, accountId: string | null, formatter: Intl.NumberFormat }) {
    const statement = result.statement;
    if (!statement) return null;
    if (statement.mismatches === 0) {
        return (
            <Card className="flex items-center gap-3 border-primary/40 bg-primary-soft p-4 font-bold">
                <CheckCircle2 className="h-8 w-8 shrink-0 text-primary"/>
                <span>Everything adds up to the statement: {formatter.format(statement.lastBalance)} on {fullDayFormatter.format(new Date(statement.lastDate))}.</span>
            </Card>
        );
    }
    const latest = statement.latestMismatch!;
    return (
        <Card className="flex flex-col gap-2 border-destructive/40 p-4">
            <p className="flex items-center gap-2 font-bold text-destructive">
                <AlertTriangle className="h-5 w-5"/>
                Doesn&apos;t add up on {statement.mismatches} {statement.mismatches === 1 ? "day" : "days"}
            </p>
            <p className="text-sm">
                The latest is {fullDayFormatter.format(new Date(latest.to))}, off by {formatter.format(Math.abs(latest.difference))}. A line may
                have been unticked or matched to a different amount. The balance follows the statement either way.
            </p>
            {accountId && <Link href={`/accounts/${accountId}`} className="text-sm font-bold text-primary">See where on the account page ›</Link>}
        </Card>
    );
}

function PreviewRow({row, accountId, onChange}: { row: PlanRow, accountId: string | null, onChange: (change: Partial<PlanRow>) => void }) {
    const formatter = useCurrencyFormatter();
    const allCategories = useAllCategories();
    const linked = Boolean(row.linkTransactionId);
    const moneyIn = row.amount > 0;
    // Money in can be income or money back in a spending category
    const categoryType = row.kind === "income" ? "income" : "expense";
    const categories = (allCategories.data ?? []).filter((c: Category) => c.type === categoryType);
    const signedKind = moneyIn ? "income" : "expense";

    return (
        <div className={cn("flex flex-col gap-2 p-3", !row.include && "opacity-50")}>
            <div className="flex items-start gap-3">
                <Checkbox checked={row.include} onCheckedChange={(checked) => onChange({include: checked === true})}
                          aria-label={`Include ${row.description}`} className="mt-1"/>
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-bold">{row.description}</span>
                    <span className="text-xs font-semibold text-muted-foreground">
                        {fullDayFormatter.format(new Date(row.date))}
                        {row.note && ` · ${row.note}`}
                    </span>
                    {row.memo && (
                        <span className="mt-1 flex items-center gap-1 self-start rounded-xl bg-secondary px-2 py-0.5 text-xs font-semibold">
                            <StickyNote className="h-3 w-3"/>{row.memo}
                        </span>
                    )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={cn("font-display font-semibold money", moneyIn ? "text-income-ink" : "text-foreground")}>
                        {moneyIn ? "+" : "−"}{formatter.format(Math.abs(row.amount))}
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-extrabold", STATUS_STYLES[row.status])}>
                        {STATUS_LABELS[row.status]}
                    </span>
                </div>
            </div>
            {row.include && (linked ? (
                <Button variant="link" size="sm" className="h-auto self-start p-0 pl-8 text-xs"
                        onClick={() => onChange({
                            linkTransactionId: null, status: "new", kind: signedKind,
                            transferAccountId: null, category: row.category ?? "Unsorted", note: null,
                        })}>
                    Import as a separate transaction instead
                </Button>
            ) : (
                <div className="grid grid-cols-1 gap-2 pl-8 sm:grid-cols-[150px_minmax(0,1fr)]">
                    <Select value={row.kind} onValueChange={(kind) => onChange({
                        kind: kind as PlanRow["kind"],
                        // Each kind has its own categories
                        category: kind === row.kind ? row.category : null,
                    })}>
                        <SelectTrigger className="h-10"><SelectValue/></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={signedKind}>{moneyIn ? "Income" : "Spending"}</SelectItem>
                            {moneyIn && <SelectItem value="expense">Money back</SelectItem>}
                            <SelectItem value="transfer">Transfer</SelectItem>
                        </SelectContent>
                    </Select>
                    {row.kind === "transfer" ? (
                        <AccountPicker value={row.transferAccountId} excludeId={accountId}
                                       placeholder={row.amount < 0 ? "To which account?" : "From which account?"}
                                       onChange={(id) => onChange({transferAccountId: id})}/>
                    ) : (
                        <div className="flex flex-col gap-1">
                            <Select value={row.category ?? NONE} onValueChange={(category) => onChange({category})}>
                                <SelectTrigger className="h-10"><SelectValue placeholder="Category"/></SelectTrigger>
                                <SelectContent>
                                    {categories.map((c) => (
                                        <SelectItem key={c.id} value={c.name}>{c.icon} {c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <SuggestionSource row={row}/>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// Where the suggested category came from, while it is still the one picked
function SuggestionSource({row}: { row: PlanRow }) {
    const suggestion = row.suggestion;
    if (!suggestion || suggestion.name !== row.category) return null;
    const label = {
        rule: "Your rule",
        history: "Like last time",
        bank: "From the bank's category",
        keyword: "From the description",
        ai: `Jev, ${Math.round((suggestion.confidence ?? 0) * 100)}% sure`,
        none: "Sort it later on the Sort page",
    }[suggestion.source];
    return <p className="text-xs font-semibold text-muted-foreground">{label}</p>;
}

const COLUMN_FIELDS: { key: keyof ColumnMapping, label: string, optional?: boolean }[] = [
    {key: "date", label: "Date"},
    {key: "description", label: "Description"},
    {key: "amount", label: "Amount", optional: true},
    {key: "debit", label: "Money out (if separate)", optional: true},
    {key: "credit", label: "Money in (if separate)", optional: true},
    {key: "category", label: "Bank category", optional: true},
    {key: "balance", label: "Running balance", optional: true},
];

function ColumnEditor({headers, mapping, busy, onApply}: {
    headers: string[], mapping: ColumnMapping, busy: boolean, onApply: (mapping: ColumnMapping) => void
}) {
    const [draft, setDraft] = useState<ColumnMapping>(mapping);
    return (
        <div className="mt-3 flex flex-col gap-3 rounded-3xl border-2 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
                {COLUMN_FIELDS.map(({key, label, optional}) => (
                    <div key={key} className="flex flex-col gap-1">
                        <Label className="text-xs">{label}</Label>
                        <Select value={(draft[key] as string | undefined) ?? NONE}
                                onValueChange={(value) => setDraft((d) => ({...d, [key]: value === NONE ? undefined : value}))}>
                            <SelectTrigger className="h-10"><SelectValue/></SelectTrigger>
                            <SelectContent>
                                {optional && <SelectItem value={NONE}>Not used</SelectItem>}
                                {headers.filter(Boolean).map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                ))}
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold">
                <Switch checked={Boolean(draft.invertSign)} onCheckedChange={(invertSign) => setDraft((d) => ({...d, invertSign}))}/>
                Purchases are positive numbers in this file (common for credit cards)
            </label>
            <div>
                <Button size="sm" onClick={() => onApply(draft)} disabled={busy}>
                    {busy ? <Loader2 className="animate-spin"/> : "Apply"}
                </Button>
            </div>
        </div>
    );
}

function ImportPage() {
    return (
        <Suspense>
            <ImportView/>
        </Suspense>
    );
}

export default ImportPage;
