"use server";

import {redirect} from "next/navigation";
import {Prisma} from "@prisma/client";
import {currentUser} from "@/lib/auth";
import prisma from "@/lib/prisma";
import {applyMapping, ColumnMapping, guessMapping, parseFile, presetLabel} from "@/lib/import/parse";
import {commitImport, CommitResult, planImport, PlanRow} from "@/lib/import/plan";
import {ColumnMappingSchema, CommitImportSchema, CommitImportSchemaType} from "@/schema/import";

// Expected failures are returned instead of thrown, because Next.js hides
// error messages thrown from server actions in production.
type ActionResult<T> = { ok: true, data: T } | { ok: false, error: string };

const MAX_FILE_BYTES = 4 * 1024 * 1024;

export type ImportPreview = {
    format: "csv" | "ofx";
    // Name of the bank format that was recognized, if any
    detected: string | null;
    headers: string[];
    mapping: ColumnMapping | null;
    rows: PlanRow[];
    // Lines without a date or amount, like balance and footer lines
    skippedLines: number;
};

async function requireUser() {
    const user = await currentUser();
    if (!user) {
        redirect('/login');
    }
    return user;
}

// A mapping saved from an earlier import only applies if the file has the same columns
function savedMapping(settings: Prisma.JsonValue | null, headers: string[]): ColumnMapping | null {
    const parsed = ColumnMappingSchema.safeParse(settings);
    if (!parsed.success) return null;
    const columns = [parsed.data.date, parsed.data.description, parsed.data.amount, parsed.data.debit,
        parsed.data.credit, parsed.data.direction, parsed.data.category, parsed.data.id];
    return columns.every((c) => !c || headers.includes(c)) ? parsed.data : null;
}

export async function PreviewImport(formData: FormData): Promise<ActionResult<ImportPreview>> {
    const user = await requireUser();
    const accountId = formData.get("accountId");
    const file = formData.get("file");
    if (typeof accountId !== "string" || !(file instanceof File)) {
        return {ok: false, error: "Choose an account and a file"};
    }
    if (file.size > MAX_FILE_BYTES) {
        return {ok: false, error: "That file is larger than 4 MB. Download a shorter date range."};
    }
    if (/\.xlsx?$/i.test(file.name)) {
        return {ok: false, error: "Excel files are not supported. Download CSV or QFX from your bank instead."};
    }

    const account = await prisma.account.findFirst({where: {id: accountId, userId: user.id}});
    if (!account) return {ok: false, error: "Account not found"};

    let parsed;
    try {
        parsed = parseFile(await file.text());
    } catch (error) {
        return {ok: false, error: error instanceof Error ? error.message : "Could not read that file"};
    }

    if (parsed.format === "ofx") {
        return {
            ok: true,
            data: {
                format: "ofx", detected: "OFX/QFX", headers: [], mapping: null,
                rows: await planImport(user.id, account, parsed.rows), skippedLines: parsed.skipped,
            },
        };
    }

    let mapping: ColumnMapping;
    const requested = formData.get("mapping");
    if (typeof requested === "string" && requested) {
        let json: unknown;
        try {
            json = JSON.parse(requested);
        } catch {
            return {ok: false, error: "Invalid column choice"};
        }
        const result = ColumnMappingSchema.safeParse(json);
        if (!result.success) return {ok: false, error: "Invalid column choice"};
        mapping = result.data;
    } else {
        mapping = savedMapping(account.importSettings, parsed.headers)
            ?? guessMapping(parsed.headers, parsed.records, account.type);
    }

    const {rows, skipped} = applyMapping(parsed.headers, parsed.records, mapping);
    if (rows.length === 0) {
        return {ok: false, error: "No transactions found. Check which columns hold the date and amount."};
    }

    return {
        ok: true,
        data: {
            format: "csv", detected: presetLabel(mapping.preset), headers: parsed.headers, mapping,
            rows: await planImport(user.id, account, rows), skippedLines: skipped,
        },
    };
}

export async function CommitImport(form: CommitImportSchemaType): Promise<ActionResult<CommitResult>> {
    const parsedBody = CommitImportSchema.safeParse(form);
    if (!parsedBody.success) {
        return {ok: false, error: "Invalid import data"};
    }
    const user = await requireUser();
    const {accountId, rows, mapping} = parsedBody.data;

    const account = await prisma.account.findFirst({where: {id: accountId, userId: user.id}});
    if (!account) return {ok: false, error: "Account not found"};

    const result = await commitImport(user.id, account, rows);
    // Remember the columns so the next file from this bank needs no adjusting
    if (mapping) {
        await prisma.account.update({where: {id: account.id}, data: {importSettings: mapping}});
    }
    return {ok: true, data: result};
}
