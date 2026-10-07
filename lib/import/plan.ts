import {Account, Prisma} from "@prisma/client";
import prisma from "@/lib/prisma";
import {payeeKey, payeesSimilar} from "@/lib/payee";
import {fingerprintRows, StatementBalance, StatementRow} from "@/lib/import/parse";
import {categorizationFields, CategorySuggestion, suggestCategories} from "@/lib/categorize/suggest";
import {getTransferCategory, intervalSummary, loadLedger} from "@/lib/accounts";
import {CENT} from "@/lib/ledger";
import {bankFromCode, isSelf, parseSelfNames, parseZelle} from "@/lib/import/zelle";

// Decides what to do with each statement line before anything is saved:
// - duplicate:  imported before (same line, or the same purchase from a CSV and a QFX file)
// - match:      a transaction you entered by hand or via Apple Pay; the import fills in the bank's amount
// - transfer:   the other side of a transfer already recorded from the other account's statement
// - pair:       an expense or income in another account that is really the other side of a transfer
// - new:        a new expense, income or transfer

export type PlanStatus = "new" | "duplicate" | "match" | "transfer" | "pair" | "skip";

export type PlanRow = {
    fingerprint: string;
    date: string;
    amount: number;
    description: string;
    status: PlanStatus;
    // Imported unless unticked; duplicates and skipped lines start unticked
    include: boolean;
    // What a new row becomes
    kind: "income" | "expense" | "transfer";
    category: string | null;
    // Where the suggested category came from; a different category means you picked it
    suggestion: CategorySuggestion | null;
    // For transfers, the user's other account
    transferAccountId: string | null;
    // For match, transfer and pair: the existing transaction it is joined to
    linkTransactionId: string | null;
    // Shown in the preview, e.g. why a line was matched or skipped
    note: string | null;
    // The bank's memo, saved as the transaction's note
    memo?: string | null;
};

const TRANSFER_WORDS = /\b(TRANSFER|XFER|PAYMENT|PYMT|PMT|E-PAYMENT|EPAYMENT|AUTOPAY|AUTO PAY|CASHOUT|CASH OUT|DEPOSIT FROM|WITHDRAWAL TO|THANK YOU)\b/i;
const TRANSFER_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date) {
    return Math.abs(a.getTime() - b.getTime()) / DAY_MS;
}

function sameAmount(a: number, b: number) {
    return Math.abs(Math.abs(a) - Math.abs(b)) < 0.005;
}

function formatDay(date: Date) {
    return date.toISOString().slice(0, 10);
}

// Another of the user's accounts that a transfer line seems to name
function guessTransferAccount(row: StatementRow, account: Account, others: Account[]): Account | null {
    if (!TRANSFER_WORDS.test(row.description)) return null;
    const text = row.description.toUpperCase();
    const named = others.find((other) => [other.institution, other.name]
        .filter((name): name is string => Boolean(name && name.length > 2))
        .some((name) => text.includes(name.toUpperCase())));
    // "VENMO PAYMENT" on a bank statement is paying someone through Venmo, which is
    // spending; only a cash-out moves money between the two accounts
    if (named && /VENMO/.test(text) && !/CASHOUT|CASH OUT|TRANSFER/.test(text)) return null;
    if (named) return named;
    // A payment arriving on a credit card most likely came from checking
    if (account.type === "credit" && row.amount > 0) {
        return others.find((other) => other.type === "checking") ?? null;
    }
    return null;
}

const sameBank = (a: Account, b: Account) =>
    Boolean(a.institution && b.institution && a.institution.trim().toLowerCase() === b.institution.trim().toLowerCase());

// For a Zelle payment to or from yourself: the account on the other end, or null when it
// could be more than one. Undefined when the line isn't one.
function selfTransferAccount(row: StatementRow, account: Account, others: Account[], selfNames: string[][]): Account | null | undefined {
    const zelle = parseZelle(row.description);
    if (!zelle || !isSelf(zelle.name, selfNames)) return undefined;
    // Zelle only reaches bank accounts
    const candidates = others.filter((o) => o.type === "checking" || o.type === "savings");
    // On money received, the confirmation code starts with the sending bank's code
    const bank = zelle.direction === "from" ? bankFromCode(zelle.code)?.toLowerCase() : null;
    const atBank = bank ? candidates.filter((o) => o.institution?.toLowerCase().includes(bank)) : [];
    if (atBank.length === 1) return atBank[0];
    const elsewhere = candidates.filter((o) => !sameBank(o, account));
    if (elsewhere.length === 1) return elsewhere[0];
    return candidates.length === 1 ? candidates[0] : null;
}

export async function planImport(userId: string, account: Account, rows: StatementRow[]): Promise<PlanRow[]> {
    const fingerprints = fingerprintRows(rows);
    const imported = new Set((await prisma.importedRow.findMany({
        where: {accountId: account.id, fingerprint: {in: fingerprints}},
        select: {fingerprint: true},
    })).map((r) => r.fingerprint));

    const others = await prisma.account.findMany({where: {userId, id: {not: account.id}, archived: false}});
    const settings = await prisma.userSettings.findUnique({where: {userId}});
    const selfNames = parseSelfNames(settings?.selfNames);

    // Transactions near the statement's dates that a line could be joined to
    const times = rows.map((r) => r.date.getTime());
    const window = rows.length === 0 ? null : {
        gte: new Date(Math.min(...times) - 10 * DAY_MS),
        lte: new Date(Math.max(...times) + 10 * DAY_MS),
    };
    const nearby = window ? await prisma.transaction.findMany({
        where: {
            userId,
            date: window,
            OR: [{accountId: account.id}, {toAccountId: account.id}, {accountId: {in: others.map((o) => o.id)}}],
        },
        include: {importedRows: {select: {accountId: true}}},
    }) : [];
    const reconciledHere = (t: typeof nearby[number]) => t.importedRows.some((r) => r.accountId === account.id);

    const used = new Set<string>();
    const claim = (id: string) => used.add(id);

    const plan = rows.map((row, i): PlanRow => {
        const base = {
            fingerprint: fingerprints[i],
            date: row.date.toISOString(),
            amount: row.amount,
            description: row.description,
            kind: (row.amount > 0 ? "income" : "expense") as PlanRow["kind"],
            category: null,
            suggestion: null,
            transferAccountId: null,
            linkTransactionId: null,
            memo: row.memo ?? null,
        };

        if (imported.has(fingerprints[i])) {
            return {...base, status: "duplicate", include: false, note: "Already imported"};
        }

        if (row.skipReason) {
            return {...base, status: "skip", include: false, note: row.skipReason};
        }

        // The same purchase imported before from a different file format
        const probableDuplicate = nearby.find((t) =>
            !used.has(t.id) && t.accountId === account.id && t.type !== "transfer" && reconciledHere(t)
            && sameAmount(t.amount, row.amount) && daysBetween(t.date, row.date) <= 1
            && (t.type === "income") === (row.amount > 0)
            && (payeesSimilar(t.description, row.description) || (t.payeeKey !== null && t.payeeKey === payeeKey(row.description))));
        if (probableDuplicate) {
            claim(probableDuplicate.id);
            return {...base, status: "duplicate", include: false, note: `Looks like "${probableDuplicate.description}", already imported`};
        }

        // A transfer recorded from the other account, waiting for this side
        const transfer = nearby.find((t) =>
            !used.has(t.id) && t.type === "transfer" && !reconciledHere(t)
            && (row.amount < 0 ? t.accountId === account.id : t.toAccountId === account.id)
            && sameAmount(t.amount, row.amount) && daysBetween(t.date, row.date) <= TRANSFER_DAYS);
        if (transfer) {
            claim(transfer.id);
            return {
                ...base, status: "transfer", include: true, kind: "transfer", category: null,
                linkTransactionId: transfer.id,
                transferAccountId: row.amount < 0 ? transfer.toAccountId : transfer.accountId,
                note: "Other side of a transfer already recorded",
            };
        }

        // An expense or income in another account that mirrors this line
        const mirror = nearby.find((t) =>
            !used.has(t.id) && t.type === (row.amount > 0 ? "expense" : "income")
            && t.accountId !== null && t.accountId !== account.id
            && sameAmount(t.amount, row.amount) && daysBetween(t.date, row.date) <= TRANSFER_DAYS
            && (TRANSFER_WORDS.test(row.description) || TRANSFER_WORDS.test(t.description)));
        if (mirror) {
            claim(mirror.id);
            const other = others.find((o) => o.id === mirror.accountId);
            return {
                ...base, status: "pair", include: true, kind: "transfer", category: null,
                linkTransactionId: mirror.id, transferAccountId: mirror.accountId,
                note: `Turns "${mirror.description}" in ${other?.name ?? "another account"} into a transfer`,
            };
        }

        // Entered by hand or by the Apple Pay shortcut; bank amounts can include a tip added later
        const candidates = nearby.filter((t) =>
            !used.has(t.id) && t.accountId === account.id && t.type !== "transfer" && !reconciledHere(t)
            && (t.source === "manual" || t.source === "apple_pay")
            && (t.type === "income") === (row.amount > 0)
            && row.date.getTime() - t.date.getTime() >= -2 * DAY_MS
            && row.date.getTime() - t.date.getTime() <= 7 * DAY_MS);
        const entered = candidates
            .filter((t) => sameAmount(t.amount, row.amount))
            .sort((a, b) => daysBetween(a.date, row.date) - daysBetween(b.date, row.date))[0]
            ?? candidates.find((t) =>
                t.type === "expense" && Math.abs(row.amount) > t.amount && Math.abs(row.amount) <= t.amount * 1.35
                && payeesSimilar(t.description, row.description));
        if (entered) {
            claim(entered.id);
            const changed = !sameAmount(entered.amount, row.amount);
            return {
                ...base, status: "match", include: true, linkTransactionId: entered.id,
                note: `Matches "${entered.description}" from ${formatDay(entered.date)}`
                    + (changed ? `, amount updated from ${entered.amount.toFixed(2)}` : ""),
            };
        }

        const toSelf = selfTransferAccount(row, account, others, selfNames);
        if (toSelf !== undefined) {
            return {
                ...base, status: "new", include: true, kind: "transfer", category: null,
                transferAccountId: toSelf?.id ?? null,
                note: toSelf
                    ? `Zelle ${row.amount < 0 ? "to" : "from"} yourself: ${row.amount < 0 ? "to" : "from"} ${toSelf.name}`
                    : "Zelle with yourself: pick the other account",
            };
        }

        const transferAccount = guessTransferAccount(row, account, others);
        if (transferAccount) {
            return {
                ...base, status: "new", include: true, kind: "transfer", category: null,
                transferAccountId: transferAccount.id,
                note: `Transfer ${row.amount < 0 ? "to" : "from"} ${transferAccount.name}?`,
            };
        }

        return {...base, status: "new", include: true, note: null};
    });

    // Categories for every line, in case one is switched to income or expense in the
    // preview; only new income and expense lines are sent to Jev
    const suggestions = await suggestCategories(
        userId,
        rows.map((row) => ({...row, accountName: account.name, accountType: account.type})),
        (i) => plan[i].status === "new" && plan[i].kind !== "transfer",
    );
    return plan.map((row, i) => row.linkTransactionId
        ? row
        : {...row, category: suggestions[i].name, suggestion: suggestions[i]});
}

export type CommitResult = {
    created: number,
    linked: number,
    skipped: number,
    // How the statement's balances compare with the transactions, when it had balances
    statement: {
        checks: number,
        lastDate: string,
        lastBalance: number,
        // Days where the transactions don't add up to the statement's change in balance
        mismatches: number,
        latestMismatch: ReturnType<typeof intervalSummary> | null,
    } | null,
};

// Saves the rows the user kept, oldest first so the order within a day matches the bank's.
// Lines imported in the meantime are skipped. Statement balances become balance checks.
export async function commitImport(userId: string, account: Account, rows: PlanRow[], balances: StatementBalance[] = []): Promise<CommitResult> {
    const result: CommitResult = {created: 0, linked: 0, skipped: 0, statement: null};
    const transferCategory = await getTransferCategory();
    for (const type of ["income", "expense"]) {
        if (!await prisma.category.findFirst({where: {name: "Unsorted", type, isUniversal: true}})) {
            await prisma.category.create({data: {name: "Unsorted", icon: "❓", type, isUniversal: true}});
        }
    }
    const categories = await prisma.category.findMany({
        where: {OR: [{userId}, {isUniversal: true}], type: {in: ["income", "expense"]}},
    });
    const categoryId = (type: string, name: string | null) =>
        (categories.find((c) => c.type === type && c.name === name && c.userId === userId)
            ?? categories.find((c) => c.type === type && c.name === name)
            ?? categories.find((c) => c.type === type && c.name === "Unsorted" && c.isUniversal))!.id;
    const ownAccounts = new Set((await prisma.account.findMany({where: {userId}, select: {id: true}})).map((a) => a.id));

    // Statements list lines newest first or oldest first
    const newestFirst = rows.length > 1 && new Date(rows[0].date) > new Date(rows[rows.length - 1].date);
    const ordered = newestFirst ? [...rows].reverse() : rows;
    // Created one millisecond apart, so lines on the same day keep the statement's order
    const start = Date.now();

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const already = new Set((await tx.importedRow.findMany({
            where: {accountId: account.id, fingerprint: {in: rows.map((r) => r.fingerprint)}},
            select: {fingerprint: true},
        })).map((r) => r.fingerprint));

        for (const [index, row] of ordered.entries()) {
            if (!row.include || already.has(row.fingerprint)) {
                result.skipped++;
                continue;
            }
            const date = new Date(row.date);
            const amount = Math.abs(row.amount);
            const createdAt = new Date(start + index);
            const note = row.memo || null;
            let transactionId: string;

            if (row.linkTransactionId) {
                const existing = await tx.transaction.findFirst({where: {id: row.linkTransactionId, userId}});
                const valid = existing && (
                    (row.status === "match" && existing.accountId === account.id && existing.type !== "transfer")
                    || (row.status === "transfer" && existing.type === "transfer"
                        && (existing.accountId === account.id || existing.toAccountId === account.id))
                    || (row.status === "pair" && existing.type !== "transfer"
                        && existing.accountId !== null && existing.accountId !== account.id && ownAccounts.has(existing.accountId))
                );
                if (!existing || !valid) {
                    result.skipped++;
                    continue;
                }
                if (row.status === "match") {
                    // The bank's amount and date are final (tips, holds)
                    await tx.transaction.update({
                        where: {id: existing.id},
                        data: {amount, date, ...(note && !existing.note ? {note} : {})},
                    });
                } else if (row.status === "pair") {
                    // The mirrored expense or income becomes one transfer between the two accounts
                    const otherId = existing.accountId!;
                    await tx.transaction.update({
                        where: {id: existing.id},
                        data: {
                            type: "transfer",
                            categoryId: transferCategory.id,
                            accountId: row.amount < 0 ? account.id : otherId,
                            toAccountId: row.amount < 0 ? otherId : account.id,
                            payeeKey: null,
                            needsReview: false,
                            categorizedBy: null,
                        },
                    });
                }
                transactionId = existing.id;
                result.linked++;
            } else if (row.kind === "transfer") {
                if (!row.transferAccountId || !ownAccounts.has(row.transferAccountId) || row.transferAccountId === account.id) {
                    result.skipped++;
                    continue;
                }
                const created = await tx.transaction.create({
                    data: {
                        userId, amount, date, createdAt, description: row.description, type: "transfer", source: "import",
                        categoryId: transferCategory.id,
                        accountId: row.amount < 0 ? account.id : row.transferAccountId,
                        toAccountId: row.amount < 0 ? row.transferAccountId : account.id,
                        note,
                    },
                });
                transactionId = created.id;
                result.created++;
            } else {
                // Money back in a spending category, like a refund, keeps that category
                const type = row.amount > 0 ? "income" : "expense";
                const categoryType = row.kind;
                const category = row.category ?? "Unsorted";
                // Changing the suggested category in the preview counts as sorting it yourself
                const pickedByYou = !row.suggestion || row.suggestion.name !== category;
                const created = await tx.transaction.create({
                    data: {
                        userId, amount, date, createdAt, description: row.description, type, source: "import",
                        categoryId: categoryId(categoryType, category),
                        accountId: account.id,
                        payeeKey: payeeKey(row.description),
                        note,
                        ...(pickedByYou
                            ? {categorizedBy: "you", needsReview: category === "Unsorted"}
                            : categorizationFields(row.suggestion!)),
                    },
                });
                transactionId = created.id;
                result.created++;
            }

            await tx.importedRow.create({data: {accountId: account.id, fingerprint: row.fingerprint, transactionId}});
        }

        if (balances.length > 0) {
            // A statement covering the same days again replaces its earlier balances
            await tx.balanceCheck.deleteMany({
                where: {
                    accountId: account.id, source: "statement",
                    date: {gte: balances[0].date, lte: balances[balances.length - 1].date},
                },
            });
            await tx.balanceCheck.createMany({
                data: balances.map((b) => ({accountId: account.id, date: b.date, balance: b.balance, source: "statement"})),
            });
        }
    }, {maxWait: 10_000, timeout: 120_000});

    if (balances.length > 0) {
        const first = balances[0].date.getTime(), last = balances[balances.length - 1].date.getTime();
        const ledger = await loadLedger(account.id);
        const mismatched = ledger.intervals.filter((i) =>
            i.to.source === "statement" && i.to.date.getTime() >= first && i.to.date.getTime() <= last
            && Math.abs(i.difference) >= CENT);
        const closing = balances[balances.length - 1];
        result.statement = {
            checks: balances.length,
            lastDate: closing.date.toISOString(),
            lastBalance: closing.balance,
            mismatches: mismatched.length,
            latestMismatch: mismatched.length ? intervalSummary(mismatched[mismatched.length - 1]) : null,
        };
    }

    return result;
}
