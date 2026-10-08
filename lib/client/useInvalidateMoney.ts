'use client';

import {useQueryClient} from "@tanstack/react-query";

// Everything that shows balances, totals or transactions, refreshed after a change
const MONEY_QUERIES = ['home', 'accounts', 'account', 'transactions', 'overview', 'reports', 'review', 'categories', 'people', 'person', 'merchants', 'rules'];

export function useInvalidateMoney() {
    const queryClient = useQueryClient();
    return () => Promise.all(MONEY_QUERIES.map((key) => queryClient.invalidateQueries({queryKey: [key]})));
}
