import {describe, expect, it} from "vitest";
import {convertPlaidTransaction} from "@/lib/plaidTransactions";
import {plaidTransaction} from "./factories";

describe("convertPlaidTransaction", () => {
    it("imports positive amounts as expenses on the posted date", () => {
        const converted = convertPlaidTransaction(plaidTransaction({
            transaction_id: "t1",
            amount: 12.345,
            date: "2026-09-10",
            merchant_name: "Pizza Place",
        }));
        expect(converted).toEqual({
            plaidTransactionId: "t1",
            amount: 12.35,
            type: "expense",
            date: new Date("2026-09-10T00:00:00.000Z"),
            description: "Pizza Place",
            categoryKey: "eating-out",
        });
    });

    it("imports negative amounts as income", () => {
        const converted = convertPlaidTransaction(plaidTransaction({
            transaction_id: "t2",
            amount: -2500,
            personal_finance_category: {primary: "INCOME", detailed: "INCOME_WAGES"},
        }));
        expect(converted?.type).toBe("income");
        expect(converted?.amount).toBe(2500);
        expect(converted?.categoryKey).toBe("paycheck");
    });

    it("falls back to the primary category, then to no category", () => {
        const primaryOnly = convertPlaidTransaction(plaidTransaction({
            transaction_id: "t3",
            personal_finance_category: {primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_SUPERSTORES"},
        }));
        expect(primaryOnly?.categoryKey).toBe("shopping");

        const unmatched = convertPlaidTransaction(plaidTransaction({
            transaction_id: "t4",
            personal_finance_category: {primary: "TRAVEL", detailed: "TRAVEL_FLIGHTS"},
        }));
        expect(unmatched?.categoryKey).toBeNull();

        const noCategory = convertPlaidTransaction(plaidTransaction({transaction_id: "t5", personal_finance_category: null}));
        expect(noCategory?.categoryKey).toBeNull();
    });

    it("uses the transaction name when there is no merchant name and truncates long text", () => {
        const converted = convertPlaidTransaction(plaidTransaction({transaction_id: "t6", name: "x".repeat(300)}));
        expect(converted?.description).toHaveLength(191);
    });

    it.each([
        ["pending", {pending: true}],
        ["transfer out", {personal_finance_category: {primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER"}}],
        ["transfer in", {personal_finance_category: {primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER"}}],
        ["credit card payment", {personal_finance_category: {primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"}}],
        ["zero amount", {amount: 0}],
    ])("skips %s transactions", (_, overrides) => {
        expect(convertPlaidTransaction(plaidTransaction({transaction_id: "skip", ...overrides}))).toBeNull();
    });
});
