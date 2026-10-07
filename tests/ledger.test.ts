import {describe, expect, it} from "vitest";
import {buildLedger, latestMismatch, LedgerCheck, LedgerTransaction, signedAmount} from "@/lib/ledger";

const at = (iso: string) => new Date(iso);
let sequence = 0;

function txn(date: string, type: string, amount: number, accountId: string | null, toAccountId: string | null = null): LedgerTransaction {
    sequence++;
    return {id: `t${sequence}`, date: at(date), createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, sequence)), type, amount, accountId, toAccountId};
}

function check(date: string, balance: number, source = "statement"): LedgerCheck {
    sequence++;
    return {id: `c${sequence}`, date: at(date), createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, sequence)), balance, source};
}

describe("signedAmount", () => {
    it("adds income, subtracts spending and moves transfers and adjustments between accounts", () => {
        expect(signedAmount({type: "income", amount: 10, accountId: "a", toAccountId: null}, "a")).toBe(10);
        expect(signedAmount({type: "expense", amount: 10, accountId: "a", toAccountId: null}, "a")).toBe(-10);
        expect(signedAmount({type: "transfer", amount: 10, accountId: "a", toAccountId: "b"}, "a")).toBe(-10);
        expect(signedAmount({type: "transfer", amount: 10, accountId: "a", toAccountId: "b"}, "b")).toBe(10);
        expect(signedAmount({type: "adjustment", amount: 3, accountId: null, toAccountId: "a"}, "a")).toBe(3);
        expect(signedAmount({type: "expense", amount: 10, accountId: "b", toAccountId: null}, "a")).toBe(0);
    });
});

describe("buildLedger", () => {
    it("sums everything when no balance was ever checked", () => {
        const ledger = buildLedger("a", [txn("2026-09-01", "income", 100, "a"), txn("2026-09-02", "expense", 30.1, "a")], []);
        expect(ledger.balance).toBe(69.9);
        expect(ledger.latestCheck).toBeNull();
    });

    it("anchors on the latest check, so older history doesn't shift the balance", () => {
        const old = txn("2026-08-01", "expense", 500, "a");
        const after = txn("2026-09-10", "expense", 20, "a");
        const ledger = buildLedger("a", [old, after], [check("2026-09-01T23:59:59.999Z", 1000, "you")]);
        expect(ledger.balance).toBe(980);
        // Running balances before the check are worked out backwards from it
        expect(ledger.runningBalances.get(old.id)).toBe(1000);
        expect(ledger.runningBalances.get(after.id)).toBe(980);
    });

    it("verifies each stretch between checks and points at the one that doesn't add up", () => {
        const a = txn("2026-09-02", "expense", 10, "a");
        const b = txn("2026-09-03", "transfer", 50, "b", "a");
        const missing = txn("2026-09-05", "expense", 7.25, "c");
        const checks = [
            check("2026-09-01T23:59:59.999Z", 100),
            check("2026-09-03T23:59:59.999Z", 140),
            // The bank also took 7.25 that Pennywise doesn't have
            check("2026-09-06T23:59:59.999Z", 132.75),
        ];
        const ledger = buildLedger("a", [a, b, missing], checks);
        expect(ledger.intervals.map((i) => [i.difference, i.transactionCount])).toEqual([[0, 2], [-7.25, 0]]);
        expect(latestMismatch(ledger)).toMatchObject({difference: -7.25, from: checks[1], to: checks[2]});
        expect(latestMismatch(ledger, at("2026-09-10"))).toBeNull();
        expect(ledger.balance).toBe(132.75);
        // Each check's own numbers hold around it
        expect(ledger.runningBalances.get(b.id)).toBe(140);
        expect(ledger.balanceAt(at("2026-09-02T23:59:59.999Z"))).toBe(90);
    });

    it("follows the latest of several checks taken with nothing in between", () => {
        const ledger = buildLedger("a", [txn("2026-09-01", "income", 5, "a")],
            [check("2026-09-02T12:00:00Z", 100, "you"), check("2026-09-03T12:00:00Z", 120, "you")]);
        expect(ledger.balance).toBe(120);
        expect(ledger.intervals[0].difference).toBe(20);
    });

    it("keeps transactions logged later on the day of a check", () => {
        const morning = check("2026-09-15T14:30:00Z", 1000, "you");
        const before = txn("2026-09-15T00:00:00Z", "expense", 45.2, "a");
        const later = txn("2026-09-15T18:00:00Z", "expense", 12.34, "a");
        expect(buildLedger("a", [before, later], [morning]).balance).toBe(987.66);
    });
});
