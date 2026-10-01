import type {Transaction as PlaidTransaction} from "plaid";

// Builds a Plaid transaction with only the fields Pennywise reads filled in
export function plaidTransaction(overrides: Partial<PlaidTransaction> & { transaction_id: string }): PlaidTransaction {
    return {
        account_id: "account-1",
        amount: 10,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
        category: null,
        category_id: null,
        date: "2026-09-10",
        location: {} as PlaidTransaction["location"],
        name: "Test merchant",
        merchant_name: null,
        payment_meta: {} as PlaidTransaction["payment_meta"],
        pending: false,
        pending_transaction_id: null,
        account_owner: null,
        authorized_date: null,
        authorized_datetime: null,
        datetime: null,
        payment_channel: "in store" as PlaidTransaction["payment_channel"],
        personal_finance_category: {primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_RESTAURANT"},
        transaction_code: null,
        ...overrides,
    };
}
