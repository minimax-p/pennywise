'use client';

import React, {useMemo, useState} from 'react';
import Link from "next/link";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {Category} from "@prisma/client";
import {FileUp, Loader2, Settings2} from "lucide-react";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Checkbox} from "@/components/ui/checkbox";
import {Switch} from "@/components/ui/switch";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import AccountPicker, {useAccounts, useRememberedAccount} from "@/app/(dashboard)/_components/AccountPicker";
import {CommitImport, ImportPreview, PreviewImport} from "@/app/(dashboard)/import/actions";
import type {PlanRow, PlanStatus} from "@/lib/import/plan";
import type {ColumnMapping} from "@/lib/import/parse";
import {cn} from "@/lib/utils";

const STATUS_LABELS: Record<PlanStatus, string> = {
    new: "New",
    duplicate: "Already imported",
    match: "Matched",
    transfer: "Transfer",
    pair: "Transfer",
    skip: "Skipped",
};

const STATUS_STYLES: Record<PlanStatus, string> = {
    new: "bg-emerald-400/10 text-emerald-500",
    duplicate: "bg-muted text-muted-foreground",
    match: "bg-sky-400/10 text-sky-500",
    transfer: "bg-violet-400/10 text-violet-400",
    pair: "bg-violet-400/10 text-violet-400",
    skip: "bg-muted text-muted-foreground",
};

const dayFormatter = new Intl.DateTimeFormat(undefined, {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});
const NONE = "__none";

function useCategories(type: "income" | "expense") {
    return useQuery<Category[]>({
        queryKey: ['categories', type],
        queryFn: () => fetch(`/api/categories?type=${type}`).then((res) => res.json()),
    });
}

function ImportPage() {
    const [accountId, setAccountId] = useRememberedAccount('pennywise:import-account');
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [rows, setRows] = useState<PlanRow[]>([]);
    const [busy, setBusy] = useState(false);
    const [showColumns, setShowColumns] = useState(false);
    const queryClient = useQueryClient();
    const accountsQuery = useAccounts();
    const accounts = Array.isArray(accountsQuery.data) ? accountsQuery.data : [];

    const loadPreview = async (mapping?: ColumnMapping) => {
        if (!accountId || !file) return;
        setBusy(true);
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
            const response = await CommitImport({accountId, rows, mapping: preview.mapping});
            if (!response.ok) {
                toast.error(response.error);
                return;
            }
            const {created, linked} = response.data;
            toast.success(`Imported ${created} new transactions${linked ? ` and matched ${linked}` : ""}`);
            setPreview(null);
            setRows([]);
            setFile(null);
            await Promise.all(['transactions', 'accounts', 'overview', 'categories'].map((key) =>
                queryClient.invalidateQueries({queryKey: [key]})));
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
        };
    }, [rows]);

    return (
        <>
            <div className='border-b bg-card'>
                <div className='container flex flex-wrap items-center justify-between gap-6 py-8'>
                    <div>
                        <p className='text-3xl font-bold'>Import statement</p>
                        <p className='text-muted-foreground'>Add transactions from a file downloaded from your bank</p>
                    </div>
                </div>
            </div>
            <div className='container flex flex-col gap-4 py-6'>
                {accounts.length === 0 && !accountsQuery.isLoading ? (
                    <Card className="p-6 text-sm">
                        First <Link href="/manage" className="underline">add the account</Link> the statement belongs to.
                    </Card>
                ) : (
                    <Card>
                        <CardHeader>
                            <CardTitle>Choose a file</CardTitle>
                            <CardDescription>
                                QFX or OFX files work best because each line has an id, so nothing is imported twice.
                                CSV works too. Lines already imported are skipped automatically.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                                <div className="flex flex-col gap-2">
                                    <Label>Account</Label>
                                    <AccountPicker value={accountId} onChange={(id) => {
                                        setAccountId(id);
                                        setPreview(null);
                                    }}/>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="statement-file">Statement file</Label>
                                    <Input id="statement-file" type="file" accept=".csv,.ofx,.qfx,.qbo,.txt"
                                           onChange={(e) => {
                                               setFile(e.target.files?.[0] ?? null);
                                               setPreview(null);
                                           }}/>
                                </div>
                                <Button onClick={() => loadPreview()} disabled={!accountId || !file || busy} className="gap-2">
                                    {busy && !preview ? <Loader2 className="h-4 w-4 animate-spin"/> : <FileUp className="h-4 w-4"/>}
                                    Preview
                                </Button>
                            </div>
                            <details className="text-sm text-muted-foreground">
                                <summary className="cursor-pointer">Where to download statements</summary>
                                <ul className="mt-2 list-disc space-y-1 pl-5">
                                    <li><b>Chase:</b> open the account, choose Download account activity, then Quicken (QFX) or Spreadsheet (CSV).</li>
                                    <li><b>Discover:</b> Activity, then Download, then Quicken (QFX) or CSV.</li>
                                    <li><b>Capital One 360:</b> open the account, choose Download Transactions, then QFX or CSV.</li>
                                    <li><b>Venmo:</b> Statements on venmo.com, then Download CSV. Payments funded from your bank card are skipped because they appear on that card&apos;s statement.</li>
                                </ul>
                            </details>
                        </CardContent>
                    </Card>
                )}

                {preview && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                                <span>Review {rows.length} lines</span>
                                <span className="text-sm font-normal text-muted-foreground">
                                    {preview.detected ? `Format: ${preview.detected}` : "Format: CSV"}
                                    {preview.skippedLines > 0 && ` · ${preview.skippedLines} lines without a date or amount ignored`}
                                </span>
                            </CardTitle>
                            <CardDescription>
                                {counts.newRows} new, {counts.linked} matched to existing transactions,
                                {' '}{counts.duplicates} already imported. Untick anything you don&apos;t want.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            {preview.format === "csv" && preview.mapping && (
                                <div>
                                    <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowColumns((v) => !v)}>
                                        <Settings2 className="h-4 w-4"/>
                                        {showColumns ? "Hide columns" : "Wrong amounts or dates? Change columns"}
                                    </Button>
                                    {showColumns && (
                                        <ColumnEditor headers={preview.headers} mapping={preview.mapping} busy={busy}
                                                      onApply={(mapping) => loadPreview(mapping)}/>
                                    )}
                                </div>
                            )}
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-8">
                                                <Checkbox
                                                    checked={rows.length > 0 && rows.every((r) => r.include)}
                                                    onCheckedChange={(checked) => setRows((current) =>
                                                        current.map((r) => ({...r, include: checked === true && r.status !== "duplicate"})))}
                                                    aria-label="Include all"/>
                                            </TableHead>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Description</TableHead>
                                            <TableHead className="text-right">Amount</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="min-w-[260px]">Becomes</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rows.map((row, index) => (
                                            <PreviewRow key={row.fingerprint + index} row={row} accountId={accountId}
                                                        onChange={(change) => updateRow(index, change)}/>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>Cancel</Button>
                                <Button onClick={commit} disabled={busy || counts.included === 0} className="gap-2">
                                    {busy && <Loader2 className="h-4 w-4 animate-spin"/>}
                                    Import {counts.included} {counts.included === 1 ? "line" : "lines"}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </>
    );
}

function PreviewRow({row, accountId, onChange}: { row: PlanRow, accountId: string | null, onChange: (change: Partial<PlanRow>) => void }) {
    const incomeCategories = useCategories("income");
    const expenseCategories = useCategories("expense");
    const linked = Boolean(row.linkTransactionId);
    const categories = row.kind === "income" ? incomeCategories.data : expenseCategories.data;
    const signedKind = row.amount > 0 ? "income" : "expense";

    return (
        <TableRow className={cn(!row.include && "opacity-50")}>
            <TableCell>
                <Checkbox checked={row.include} onCheckedChange={(checked) => onChange({include: checked === true})}
                          aria-label={`Include ${row.description}`}/>
            </TableCell>
            <TableCell className="whitespace-nowrap">{dayFormatter.format(new Date(row.date))}</TableCell>
            <TableCell className="max-w-[260px]">
                <div className="truncate">{row.description}</div>
                {row.note && <div className="truncate text-xs text-muted-foreground">{row.note}</div>}
            </TableCell>
            <TableCell className={cn("whitespace-nowrap text-right font-mono", row.amount > 0 ? "text-sky-500" : "text-amber-500")}>
                {row.amount > 0 ? "+" : "-"}{Math.abs(row.amount).toFixed(2)}
            </TableCell>
            <TableCell>
                <span className={cn("whitespace-nowrap rounded-lg px-2 py-1 text-xs", STATUS_STYLES[row.status])}>
                    {STATUS_LABELS[row.status]}
                </span>
            </TableCell>
            <TableCell>
                {linked ? (
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs"
                            onClick={() => onChange({
                                linkTransactionId: null, status: "new", kind: signedKind,
                                transferAccountId: null, category: row.category ?? "Unsorted", note: null,
                            })}>
                        Import as a separate transaction instead
                    </Button>
                ) : (
                    <div className="flex gap-2">
                        <Select value={row.kind} onValueChange={(kind) => onChange({kind: kind as PlanRow["kind"]})}>
                            <SelectTrigger className="h-8 w-[110px]"><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={signedKind}>{signedKind === "income" ? "Income" : "Expense"}</SelectItem>
                                <SelectItem value="transfer">Transfer</SelectItem>
                            </SelectContent>
                        </Select>
                        {row.kind === "transfer" ? (
                            <div className="min-w-[150px] flex-1">
                                <AccountPicker value={row.transferAccountId} excludeId={accountId}
                                               placeholder={row.amount < 0 ? "To account" : "From account"}
                                               onChange={(id) => onChange({transferAccountId: id})}/>
                            </div>
                        ) : (
                            <Select value={row.category ?? NONE} onValueChange={(category) => onChange({category})}>
                                <SelectTrigger className="h-8 min-w-[150px] flex-1"><SelectValue placeholder="Category"/></SelectTrigger>
                                <SelectContent>
                                    {(categories ?? []).map((c) => (
                                        <SelectItem key={c.id} value={c.name}>{c.icon} {c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                )}
            </TableCell>
        </TableRow>
    );
}

const COLUMN_FIELDS: { key: keyof ColumnMapping, label: string, optional?: boolean }[] = [
    {key: "date", label: "Date"},
    {key: "description", label: "Description"},
    {key: "amount", label: "Amount", optional: true},
    {key: "debit", label: "Money out (if separate)", optional: true},
    {key: "credit", label: "Money in (if separate)", optional: true},
    {key: "category", label: "Bank category", optional: true},
];

function ColumnEditor({headers, mapping, busy, onApply}: {
    headers: string[], mapping: ColumnMapping, busy: boolean, onApply: (mapping: ColumnMapping) => void
}) {
    const [draft, setDraft] = useState<ColumnMapping>(mapping);
    return (
        <div className="mt-3 flex flex-col gap-3 rounded-md border p-4">
            <div className="grid gap-3 sm:grid-cols-3">
                {COLUMN_FIELDS.map(({key, label, optional}) => (
                    <div key={key} className="flex flex-col gap-1">
                        <Label className="text-xs">{label}</Label>
                        <Select value={(draft[key] as string | undefined) ?? NONE}
                                onValueChange={(value) => setDraft((d) => ({...d, [key]: value === NONE ? undefined : value}))}>
                            <SelectTrigger className="h-8"><SelectValue/></SelectTrigger>
                            <SelectContent>
                                {optional && <SelectItem value={NONE}>Not used</SelectItem>}
                                {headers.filter(Boolean).map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
                <Switch checked={Boolean(draft.invertSign)} onCheckedChange={(invertSign) => setDraft((d) => ({...d, invertSign}))}/>
                Purchases are positive numbers in this file (common for credit cards)
            </label>
            <div>
                <Button size="sm" onClick={() => onApply(draft)} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin"/> : "Apply"}
                </Button>
            </div>
        </div>
    );
}

export default ImportPage;
