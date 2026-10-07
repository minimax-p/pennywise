# Pennywise

A personal finance tracker for one person, meant to run on your own server. Track spending across your bank accounts and cards, import bank statements, log Apple Pay purchases automatically from your iPhone, and see totals, balances and history charts.

Built with Next.js 14 (App Router), Prisma with MySQL/MariaDB, TanStack Query, shadcn/ui and Recharts.

## Features

- **Accounts:** checking, savings, credit cards and cash/wallets (like Venmo), each with a balance. The dashboard shows every balance plus your net worth.
- **Transfers:** money moved between your own accounts, such as paying the credit card from checking or moving money to savings. Transfers are not counted as income or spending, so a card purchase isn't counted a second time when you pay the bill.
- **Statement import:** upload a CSV, QFX, OFX or QBO file downloaded from your bank and review a preview before anything is saved.
  - Lines you have already imported are skipped.
  - Purchases you logged by hand or through Apple Pay are matched and updated with the bank's final amount, including tips.
  - Transfers are recognized from both accounts' statements.
  - Categories are suggested from what you picked before for the same merchant.
- **Apple Pay shortcut:** an iPhone Shortcuts automation logs each Apple Pay purchase the moment you pay, in the right account and category.
- **Sort page:** every transaction Pennywise isn't sure about waits here with one-tap category suggestions. One tap can also sort every other waiting transaction from the same merchant, and your choices are remembered for next time.
- **AI sorting with Jev (optional):** with a TypeSafe AI key, Jev picks categories for merchants you haven't sorted before. Confident answers are filed automatically and unsure ones go to the Sort page.
- **Dashboard:** income, spending and balance for a date range, spending by category, and monthly or yearly history.
- **Transactions:** search, filter by type or account, and edit or delete. Editing can also change the type, for example turning a card payment into a transfer.
- **Login:** a single password. Wrong guesses are throttled, and the session cookie is signed.
- **iPhone home screen:** add Pennywise to the home screen from Safari and it opens like an app.
- **Optional Plaid bank sync:** shown only if you configure Plaid credentials.

## Running locally

Requirements: Node.js 20+ and MySQL 8 or MariaDB 10.11+.

```bash
npm install
cp .env.example .env
node scripts/hash-password.mjs      # paste the output into PENNYWISE_PASSWORD_HASH
openssl rand -base64 32             # paste into SESSION_SECRET
# set DATABASE_URL to your local database
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000 and enter your password.

## Deploying to a server

These steps fit a small VPS such as a $6/month Vultr instance with 1 GB of RAM running Ubuntu. Docker Compose runs:
- the app
- MariaDB
- Caddy, which gets and renews the HTTPS certificate
- a backup job that dumps the database every day

1. **Point a domain at the server.** Create a DNS `A` record for a domain or subdomain you own (for example `money.yourname.com`) pointing at the server's IP address.

2. **Prepare the server.** SSH in, then install Docker, add swap (building the app needs more than 1 GB of memory) and open the firewall:
   ```bash
   curl -fsSL https://get.docker.com | sh
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw allow 443/udp && ufw --force enable
   ```

3. **Get the code and configure it.**
   ```bash
   git clone https://github.com/minimax-p/pennywise.git && cd pennywise
   cp .env.example .env
   ```
   Fill in `.env`:
   - `DOMAIN`: your domain from step 1
   - `DB_PASSWORD` and `DB_ROOT_PASSWORD`: each from `openssl rand -hex 24`
   - `SESSION_SECRET`: from `openssl rand -base64 32`
   - `TZ`: your time zone, e.g. `America/Los_Angeles`
   - `PENNYWISE_NAME`: optional

   Then create your password hash and paste it into `PENNYWISE_PASSWORD_HASH`:
   ```bash
   docker compose run --rm migrate node scripts/hash-password.mjs
   ```

4. **Start it.**
   ```bash
   docker compose up -d --build
   ```
   The first build takes a few minutes. Then open `https://your-domain` and log in.

5. **Update later.**
   ```bash
   git pull && docker compose up -d --build
   ```
   Database migrations run automatically on every start.

### Backups

Every day the `backup` service writes `backups/pennywise-YYYY-MM-DD.sql.gz` next to `docker-compose.yml` and keeps two weeks of files. Copy them off the server now and then, for example from your Mac:

```bash
scp root@your-server:pennywise/backups/*.sql.gz ~/Documents/pennywise-backups/
```

Vultr's automatic backups or snapshots are a good second layer.

To restore a backup:

```bash
gunzip -c backups/pennywise-2026-10-01.sql.gz | docker compose exec -T db sh -c 'mariadb -u pennywise -p"$MARIADB_PASSWORD" pennywise'
```

### Security notes

- Use a long password, at least 12 characters (the hash script enforces that). After 5 wrong attempts, an IP address is locked out for 15 minutes.
- Changing `SESSION_SECRET` logs out every session.
- Caddy strips the `x-middleware-subrequest` header and adds HSTS and other security headers.
- Apple Pay shortcut keys are stored as hashes. Revoke one on the Manage page if you lose the phone.

## Getting your transactions in

### 1. Add your accounts

On **Manage → Accounts**, add each account with its current balance, for example:
- Chase checking (Checking, bank Chase)
- Discover it (Credit card, bank Discover)
- Capital One savings (Savings, bank Capital One); add a separate account for each CD if you want to track it
- Venmo (Cash or wallet, bank Venmo)

Filling in the **bank** name helps the importer recognize transfers, such as "DISCOVER E-PAYMENT" on your Chase statement. For cards you use with Apple Pay, enter the **Apple Wallet card name** exactly as Wallet shows it.

### 2. Import statements

Download a statement and upload it on **Import**. Prefer QFX when your bank offers it: every line has an id, so re-importing overlapping date ranges never creates duplicates.

| Bank | Where | Format |
|---|---|---|
| Chase | Account → Download account activity | QFX or CSV |
| Discover | Activity → Download | QFX or CSV |
| Capital One 360 | Account → Download Transactions | QFX or CSV |
| Venmo | venmo.com → Statements → Download CSV | CSV |

Venmo payments funded straight from a bank card are left out, because they already appear on that card's statement as "VENMO PAYMENT". Payments from your Venmo balance are imported. If the importer misreads a CSV (for example card purchases shown as income), use **Change columns** in the preview. Your choice is remembered for that account.

### 3. Log Apple Pay purchases automatically

On **Manage → Apple Pay shortcut**, click **Set up the shortcut**. It creates a key and walks you through a Shortcuts automation on your iPhone that sends the amount, merchant and card of each Apple Pay purchase to Pennywise.

The automation only sees Apple Pay taps: no online purchases typed in by card number, and no swipes of the physical card. Importing statements fills in the rest, and matches the purchases already logged instead of duplicating them.

### 4. Sort what's left

Pennywise picks a category for each new transaction, trying in this order:
1. what you chose before for the same merchant
2. the category in the bank's export
3. keywords such as PAYROLL or NETFLIX
4. Jev, if it's turned on (see below)

Anything it isn't sure about goes to **Sort**, which shows a count in the menu and a reminder on the dashboard.
- Tap the right category, or **Other category** for the full list.
- Leave **Also sort N more from this merchant** ticked to sort the rest of that merchant's waiting transactions at the same time.
- **Edit** opens the full editor, for example to turn a line into a transfer.

The category you pick is used the next time that merchant shows up, so the Sort page gets shorter over time.

### 5. Add Pennywise to the home screen

In Safari, open your Pennywise address, tap Share, then **Add to Home Screen**.

## Optional: AI sorting with Jev

[Jev](https://typesafe.ai) is TypeSafe AI's classification model. Pennywise asks it to pick one of your categories for merchants it hasn't seen you sort, and sends it your recent choices as examples.
- Jev's confidence decides what happens. At 80% or more, the category is filed automatically. Below that, the transaction goes to the Sort page with Jev's top guesses as the buttons.
- It's asked once per merchant per import, never for merchants you've already sorted, and never for transfers.
- At Jev's published price ($42 per billion input tokens) a year of transactions costs well under a cent.

To turn it on, create an API key at typesafe.ai and add it to `.env` on the server, then restart:

```bash
echo 'TYPESAFE_API_KEY=your-key' >> .env
docker compose up -d
```

For a new merchant, Jev receives the transaction's description, amount, date, the account's name and type, the bank's category, your category names, and up to 40 of your recent merchant → category choices. It doesn't receive account numbers or balances. Check TypeSafe's terms for how they handle that data. Without a key, nothing leaves your server and everything else works the same.

To sort transactions that came in before you added the key, use **Ask Jev** on the Sort page.

## Optional: Plaid bank sync

Pennywise can also pull transactions through Plaid. The Plaid section on the Manage page only appears when `PLAID_CLIENT_ID` and `PLAID_SECRET` are set.
- Plaid offers a free Trial plan for personal use in the US and Canada; check the terms on Plaid's site.
- Set `PLAID_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`). Access tokens are stored encrypted with it.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm test` | Tests (see below) |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Add the shared categories (safe to run again) |
| `node scripts/hash-password.mjs` | Print a password hash for `PENNYWISE_PASSWORD_HASH` |

### Tests

`npm test` runs the unit tests. The database tests (import, accounts, sorting, Apple Pay capture, Plaid sync and server actions) run when `TEST_DATABASE_URL` points at a disposable database that has been migrated and seeded:

```bash
DATABASE_URL="mysql://user:password@localhost:3306/pennywise_test" npm run db:migrate
DATABASE_URL="mysql://user:password@localhost:3306/pennywise_test" npm run db:seed
TEST_DATABASE_URL="mysql://user:password@localhost:3306/pennywise_test" npm test
```

## Project layout

```
app/
  (auth)/login/           Password login
  (dashboard)/            Dashboard, Transactions, Import and Manage pages
    _actions/             Server actions (transactions, accounts, categories, sorting, Apple Pay keys, Plaid)
    _components/          Dashboard and Manage page components
    import/               Statement import page and actions
    review/               Sort page
    transactions/         Transactions table and dialogs
  api/                    Route handlers the pages read from; api/capture is the Apple Pay endpoint
  wizard/                 First-run currency setup
components/               Shared components and shadcn/ui
lib/
  auth.ts, session.ts     Login session
  accounts.ts             Account balances and transfers
  history.ts              Keeps daily and monthly totals in step with transactions
  import/                 Statement parsing and matching
  categorize/             Category suggestions: your history, bank categories, keywords and Jev
  capture.ts              Apple Pay shortcut keys and card matching
  payee.ts                Normalizes merchant names to recognize repeat merchants
  plaid*.ts, crypto.ts    Optional Plaid sync
prisma/                   Schema, migrations and the category seed
scripts/                  Password hash helper
tests/                    Vitest tests and sample statements
Dockerfile, docker-compose.yml, Caddyfile   Deployment
```

`MonthHistory` and `YearHistory` store running daily and monthly totals for the history chart. Every change to an income or expense goes through `applyHistoryChanges` in `lib/history.ts` so those totals stay correct. Transfers don't affect them.
