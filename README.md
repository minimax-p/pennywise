# Pennywise

A personal finance tracker. Log income and expenses by hand or import them from your bank through Plaid, sort them into categories, and see totals and history charts on a dashboard.

Built with Next.js 14 (App Router), Clerk for sign-in, Prisma with MySQL, TanStack Query, shadcn/ui and Recharts.

## Features

- **Dashboard**: income, expense and balance for a date range (up to 90 days), spending by category, and a monthly or yearly history chart.
- **Transactions**: a searchable table of transactions in a date range, filterable by type, with edit and delete.
- **Bank import (Plaid)**: link bank accounts from the Manage page. Pennywise imports posted transactions, keeps them up to date when you press Sync, and lets you reconnect when a bank login expires or unlink a bank (optionally deleting what it imported).
- **Categories**: about 80 shared categories, plus your own income and expense categories.
- **Currency**: choose the currency used to display amounts.

## Getting started

Requirements: Node.js 18.17 or newer and a MySQL 8 (or MariaDB 10.11+) database.

```bash
npm install
cp .env.example .env      # then fill in the values, see below
npm run db:migrate        # create the tables
npm run db:seed           # add the shared categories
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign up. On first sign-in you will be asked to pick a currency.

### Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | MySQL connection string, e.g. `mysql://user:password@localhost:3306/pennywise` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | From the [Clerk dashboard](https://dashboard.clerk.com) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-in` and `/sign-up` |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | From the [Plaid dashboard](https://dashboard.plaid.com/developers/keys). Use the secret that matches `PLAID_ENV` |
| `PLAID_ENV` | `sandbox` (default) or `production` |
| `PLAID_COUNTRY_CODES` | Countries offered in Plaid Link, comma separated. Defaults to `US` |
| `PLAID_TOKEN_ENCRYPTION_KEY` | 32-byte key that encrypts Plaid access tokens in the database. Generate with `openssl rand -base64 32`. Changing it makes existing bank links unusable, so they must be unlinked and linked again |

## Linking a bank account

1. Go to **Manage → Link Your Bank Accounts** and click **Link a bank account**.
2. In sandbox, pick any bank and sign in with username `user_good` and password `pass_good`.
3. Pennywise imports the transactions Plaid has ready. Plaid keeps fetching older history (up to a year) in the background, so press **Sync** again later to pull in the rest and any new transactions.

How imported transactions are handled:

- Only posted transactions are imported. Pending ones show up once they post.
- Transfers between your own accounts and credit card payments are skipped so the same money is not counted twice.
- Each transaction is filed under a shared category based on Plaid's category, or under **Unsorted** when there is no match. The mapping is in `lib/plaidTransactions.ts`.
- You can edit or delete imported transactions. Your description and category edits are kept on later syncs, but if the bank changes the amount or date, the next sync applies that change. Deleted transactions are not brought back.
- Amounts are imported as they are. If your Pennywise currency differs from the bank account's currency, they are not converted.

Pennywise has no Plaid webhook endpoint, so new transactions arrive when you press Sync rather than automatically.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint (`next lint`) |
| `npm test` | Unit tests with Vitest |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Add the shared categories (safe to run again) |

### Database tests

The Plaid sync and server action tests need a real MySQL database. Point `TEST_DATABASE_URL` at a disposable database that has been migrated and seeded; without it those tests are skipped:

```bash
DATABASE_URL="mysql://user:password@localhost:3306/pennywise_test" npm run db:migrate
DATABASE_URL="mysql://user:password@localhost:3306/pennywise_test" npm run db:seed
TEST_DATABASE_URL="mysql://user:password@localhost:3306/pennywise_test" npm test
```

## Project layout

```
app/
  (auth)/                 Clerk sign-in and sign-up pages
  (dashboard)/            Dashboard, Transactions and Manage pages
    _actions/             Server actions (transactions, categories, Plaid)
    _components/          Dashboard and Manage page components
    transactions/         Transactions page and its table and dialogs
  api/                    Route handlers the pages read from
  wizard/                 First-run currency setup
components/               Shared components, including PlaidLink and shadcn/ui
lib/
  history.ts              Keeps the daily and monthly totals in step with transactions
  plaid.ts                Plaid client
  plaidSync.ts            Imports changes from Plaid /transactions/sync
  plaidTransactions.ts    Converts and categorizes Plaid transactions
  crypto.ts               Encrypts Plaid access tokens
prisma/                   Schema, migrations and the category seed
schema/                   Zod schemas for forms and query parameters
tests/                    Vitest tests
```

`MonthHistory` and `YearHistory` store running daily and monthly totals that the history chart reads. Every change to a transaction goes through `applyHistoryChanges` in `lib/history.ts` so those totals stay correct.
