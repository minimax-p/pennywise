// Copies a Pennywise database from MariaDB/MySQL into PostgreSQL. scripts/deploy.sh runs it
// once, through SSH tunnels, when moving off the old Docker install:
//
//   MYSQL_URL=mysql://user:pass@host:3306/pennywise \
//   DATABASE_URL=postgresql://user:pass@host:5432/pennywise \
//   node scripts/copy-from-mariadb.mjs
//
// The PostgreSQL database must have only the first (baseline) migration applied. The later
// migrations run after the copy, so the data changes they make apply to your data too.
//
// Reads every MySQL schema Pennywise has deployed: older ones get the same data changes the
// MySQL migrations would have made (a balance check from each account's stored balance,
// Unsorted transactions put on the Sort page, Zelle merchant keys cleared). Everything is
// written in one transaction and read back to check that each row arrived unchanged, so the
// copy either completes exactly or leaves PostgreSQL empty.
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {PrismaClient} from "@prisma/client";

// Baseline tables, parents before children
const TABLES = ["UserSettings", "Category", "PlaidItem", "Account", "BalanceCheck", "Transaction", "ImportedRow", "CaptureToken"];
const BATCH = 500;

const mysqlUrl = process.env.MYSQL_URL;
if (!mysqlUrl || !process.env.DATABASE_URL) {
    console.error("Set MYSQL_URL and DATABASE_URL");
    process.exit(2);
}

// MySQL keeps Prisma's UTC times as plain DATETIME(3); read them as text so no time zone applies
const source = await mysql.createConnection({uri: mysqlUrl, dateStrings: true, supportBigNumbers: true});
const target = new PrismaClient();

const quote = (name) => `"${name}"`;
const iso = (text) => new Date(text.replace(" ", "T") + "Z").toISOString();
const stripNul = (text) => text.replace(/\u0000/g, "");
// JSON with sorted keys, since PostgreSQL's jsonb doesn't keep their order
const canonical = (value) => JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);
const parseJson = (value) => typeof value === "string" ? JSON.parse(value) : value;

async function sourceTables() {
    const [rows] = await source.query("SHOW TABLES");
    return new Set(rows.map((r) => Object.values(r)[0]));
}

async function readSource(table) {
    const [rows] = await source.query(`SELECT * FROM \`${table}\``);
    return rows;
}

async function targetColumns(tx, table) {
    const rows = await tx.$queryRawUnsafe(
        `SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable, column_default IS NOT NULL AS "hasDefault"
         FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, table);
    return new Map(rows.map((c) => [c.name, c]));
}

const CASTS = {
    "timestamp without time zone": "timestamp(3)",
    "double precision": "double precision",
    "integer": "integer",
    "boolean": "boolean",
    "jsonb": "jsonb",
    "text": "text",
    "character varying": "text",
};

// A source value as PostgreSQL should receive it, and the same value in a form both sides
// can be compared by
function convert(value, type) {
    if (value === null || value === undefined) return null;
    switch (type) {
        case "timestamp without time zone":
            return iso(String(value));
        case "boolean":
            return Boolean(Number(value));
        case "double precision":
        case "integer":
            return Number(value);
        case "jsonb": {
            // A JSON null reads the same as no value
            const parsed = parseJson(value);
            return parsed === null ? null : JSON.stringify(parsed);
        }
        default:
            return stripNul(String(value));
    }
}

function comparable(value, type) {
    if (value === null || value === undefined) return null;
    if (type === "timestamp without time zone") return (value instanceof Date ? value : new Date(value)).toISOString();
    if (type === "jsonb") return canonical(parseJson(value));
    if (type === "double precision" || type === "integer") return Number(value);
    return value;
}

async function insert(tx, table, columns, rows) {
    const names = [...columns.keys()];
    for (let start = 0; start < rows.length; start += BATCH) {
        const batch = rows.slice(start, start + BATCH);
        const params = [];
        const values = batch.map((row) => "(" + names.map((name) => {
            params.push(row[name]);
            return `$${params.length}::${CASTS[columns.get(name).type] ?? "text"}`;
        }).join(", ") + ")");
        await tx.$executeRawUnsafe(
            `INSERT INTO ${quote(table)} (${names.map(quote).join(", ")}) VALUES ${values.join(", ")}`, ...params);
    }
}

// Reads the table back and checks every copied value
async function verify(tx, table, columns, rows) {
    const names = [...columns.keys()];
    const copied = await tx.$queryRawUnsafe(`SELECT ${names.map(quote).join(", ")} FROM ${quote(table)}`);
    if (copied.length !== rows.length) throw new Error(`${table}: copied ${copied.length} rows instead of ${rows.length}`);
    const key = columns.has("id") ? "id" : names[0];
    const byKey = new Map(copied.map((r) => [r[key], r]));
    for (const row of rows) {
        const back = byKey.get(row[key]);
        if (!back) throw new Error(`${table}: row ${row[key]} is missing after the copy`);
        for (const name of names) {
            const type = columns.get(name).type;
            const want = comparable(row[name], type);
            const got = comparable(back[name], type);
            // Doubles may come back a few bits apart, far below a cent
            const same = typeof want === "number" && typeof got === "number"
                ? Math.abs(want - got) <= 1e-9 * Math.max(1, Math.abs(want))
                : want === got;
            if (!same) throw new Error(`${table} ${row[key]}: ${name} is ${got} instead of ${want}`);
        }
    }
}

// Same rule as lib/ledger.ts: the latest check plus the transactions after it
function balances(accounts, checks, transactions) {
    const time = (r) => [new Date(r.date).getTime(), new Date(r.createdAt).getTime()];
    const after = (a, b) => {
        const [ad, ac] = time(a), [bd, bc] = time(b);
        return ad > bd || (ad === bd && ac > bc);
    };
    return accounts.map((account) => {
        const latest = checks.filter((c) => c.accountId === account.id)
            .reduce((best, c) => (!best || after(c, best) ? c : best), null);
        let balance = latest ? latest.balance : 0;
        for (const t of transactions) {
            if (latest && !after(t, latest)) continue;
            if (t.accountId === account.id) balance += t.type === "income" ? t.amount : -t.amount;
            if ((t.type === "transfer" || t.type === "adjustment") && t.toAccountId === account.id) balance += t.amount;
        }
        return {name: account.name, balance: Math.round(balance * 100) / 100};
    });
}

async function main() {
    const available = await sourceTables();
    if (!available.has("Transaction") || !available.has("Account")) {
        throw new Error("The MariaDB database doesn't look like Pennywise (no Transaction or Account table)");
    }

    const migrations = await target.$queryRawUnsafe(
        `SELECT migration_name AS name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`);
    if (migrations.length !== 1) {
        throw new Error(`PostgreSQL should have only the baseline migration applied, found ${migrations.length}`);
    }
    for (const table of TABLES) {
        const [{count}] = await target.$queryRawUnsafe(`SELECT count(*)::int AS count FROM ${quote(table)}`);
        if (count > 0) throw new Error(`PostgreSQL already has data in ${table}; copy only into an empty database`);
    }

    // Source rows, brought up to the current schema
    const data = {};
    for (const table of TABLES) data[table] = available.has(table) ? await readSource(table) : [];

    const legacyBalances = !available.has("BalanceCheck") && data.Account.some((a) => "knownBalance" in a);
    if (legacyBalances) {
        // Each account's stored balance becomes its first check, as the MySQL migration did
        const now = new Date().toISOString().replace("T", " ").replace("Z", "");
        data.BalanceCheck = data.Account.map((a) => ({
            id: randomUUID(), accountId: a.id, date: a.knownBalanceDate, balance: a.knownBalance, source: "you", createdAt: now,
        }));
    }
    const categoryNames = new Map(data.Category.map((c) => [c.id, c.name]));
    for (const t of data.Transaction) {
        if (!("needsReview" in t)) {
            // Transactions filed under Unsorted start out on the Sort page
            t.needsReview = categoryNames.get(t.categoryId) === "Unsorted" && (t.type === "income" || t.type === "expense") ? 1 : 0;
        }
        if (t.payeeKey === "ZELLE TO" || t.payeeKey === "ZELLE FROM") t.payeeKey = null;
    }

    const summary = [];
    await target.$transaction(async (tx) => {
        for (const table of TABLES) {
            const rows = data[table];
            const columns = await targetColumns(tx, table);
            const present = new Set(rows.flatMap((r) => Object.keys(r)));
            const dropped = [...present].filter((name) => !columns.has(name));
            // Columns the old schema didn't have take their default
            const copied = new Map([...columns].filter(([name]) => present.has(name)));
            for (const [name, column] of columns) {
                if (!present.has(name) && !column.nullable && !column.hasDefault && rows.length > 0) {
                    throw new Error(`${table}.${name} has no value in MariaDB and no default`);
                }
            }
            const converted = rows.map((row) => Object.fromEntries(
                [...copied].map(([name, column]) => [name, convert(row[name], column.type)])));
            if (converted.length > 0) {
                await insert(tx, table, copied, converted);
                await verify(tx, table, copied, converted);
            }
            summary.push({table, rows: converted.length, dropped});
        }
    }, {maxWait: 60_000, timeout: 30 * 60_000});

    const skipped = [...available].filter((t) => !TABLES.includes(t) && t !== "_prisma_migrations");
    console.log("Copied and checked every row:");
    for (const {table, rows, dropped} of summary) {
        console.log(`  ${table.padEnd(14)} ${String(rows).padStart(6)}${dropped.length ? `  (left out old columns: ${dropped.join(", ")})` : ""}`);
    }
    if (legacyBalances) console.log("  Each account's balance became its first balance check.");
    if (skipped.length) console.log(`  Not needed any more: ${skipped.join(", ")}`);

    const toNumber = (rows) => rows.map((r) => ({...r, amount: Number(r.amount), balance: Number(r.balance)}));
    const after = balances(
        await target.$queryRawUnsafe(`SELECT id, name FROM "Account" ORDER BY name`),
        toNumber(await target.$queryRawUnsafe(`SELECT "accountId", date, "createdAt", balance FROM "BalanceCheck"`)),
        toNumber(await target.$queryRawUnsafe(`SELECT "accountId", "toAccountId", type, amount, date, "createdAt" FROM "Transaction"`)),
    );
    if (after.length) {
        console.log("Balances:");
        for (const {name, balance} of after) console.log(`  ${name.padEnd(28)} ${balance.toFixed(2).padStart(12)}`);
    }
}

main()
    .catch((error) => {
        console.error(`Copy failed, PostgreSQL was left unchanged: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await source.end();
        await target.$disconnect();
    });
