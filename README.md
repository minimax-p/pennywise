# Pennywise

A personal finance tracker for one person, meant to run on your own server. Every account and every dollar in one place: balances checked against your bank, statements imported and verified day by day, Apple Pay purchases logged from your iPhone, and a phone-first design.

Built with Next.js 14 (App Router), Prisma with PostgreSQL, TanStack Query, shadcn/ui and Recharts.

## Features

- **Home:** your *spending money* (cash and checking minus what your cards owe), savings and CDs, what friends owe you, net worth, what needs attention, how this month's spending compares with last month, where it went, and recent activity. Balances are always as of today.
- **Accounts:** checking, savings, CDs (with rate and maturity date), credit cards, cash, and wallets like Venmo. Each account has a page with a running balance after every line, like your bank's app.
- **Balance checks:** type in what your bank shows, or import a statement that includes balances, and Pennywise tells you whether the transactions add up. An account's balance is its latest check plus the transactions after it, so importing older statements never shifts it, and a stretch that doesn't add up is pointed out to the day.
- **Transfers:** money moved between your own accounts, such as paying the credit card from checking or moving money to savings. Transfers are not counted as income or spending, so a card purchase isn't counted a second time when you pay the bill.
- **Statement import:** upload a CSV, QFX, OFX or QBO file downloaded from your bank and review a preview before anything is saved.
  - Statement balances (Chase's Balance column, the balance in QFX files) are saved as balance checks and verified after the import.
  - Zelle payments to or from your own name become transfers between your accounts.
  - Lines you have already imported are skipped.
  - Purchases you logged by hand or through Apple Pay are matched and updated with the bank's final amount, including tips.
  - Transfers are recognized from both accounts' statements.
  - Categories are suggested from what you picked before for the same merchant.
- **Logging in a few taps:** the + button opens a number pad (type 8640 for $86.40). Pick a place you've been and Pennywise fills in how you paid and the category from last time. **Split** divides a payment between categories and people, **Paid back** settles what someone owes you, and **Later** leaves it for the Sort page.
- **People:** Zelle and Venmo payments are linked to the person on the line, with their notes in view. Splitting a bill adds up what each person owes you; when they pay you back it settles, without counting as income.
- **Cash:** a Cash account works like any other. ATM withdrawals and cash deposits on your bank statement move money in and out of it, ATM and overdraft fees are filed as Fees & interest, and when you count your wallet, a shortfall can be counted as cash you spent without logging.
- **iPhone shortcuts:** an automation logs each Apple Pay purchase the moment you pay, and **Log a purchase** asks four quick questions (how much, where, paid with, category) for card swipes and cash, from the Action button, Back Tap or Siri.
- **Sort page:** every transaction Pennywise isn't sure about waits here with one-tap category suggestions. One tap can also sort every other waiting transaction from the same merchant, and your choices are remembered for next time.
- **AI sorting with Jev (optional):** with a TypeSafe AI key, Jev picks categories for merchants you haven't sorted before. Confident answers are filed automatically and unsure ones go to the Sort page.
- **Spending that means something:** moving money between your accounts isn't spending or income. A refund, or a friend paying you back, filed under the spending category it was for lowers that spending instead of counting as income.
- **Reports:** spending and money in by month or year, by category, with a chart and a table.
- **Transactions:** every account in one list, grouped by day. Search descriptions, people, notes, categories and amounts, filter by kind, account or dates, and tap a line to edit or delete it.
- **Login:** a single password. Wrong guesses are throttled, and the session cookie is signed.
- **Made for the iPhone:** a bottom tab bar with a + button, sheets that slide up, big tap targets, and a soft dark mode that follows your phone. Add it to the home screen from Safari and it opens like an app.
- **Optional Plaid bank sync:** shown only if you configure Plaid credentials.

## Running locally

Requirements: Node.js 20+ and PostgreSQL 13+ (on a Mac: `brew install postgresql@16 && brew services start postgresql@16`).

```bash
npm install
createdb pennywise
cp .env.example .env
node scripts/hash-password.mjs      # paste the output into PENNYWISE_PASSWORD_HASH
openssl rand -base64 32             # paste into SESSION_SECRET
# DATABASE_URL in .env points at the pennywise database; change it if your setup differs
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000 and enter your password.

## Deploying to a server

Pennywise runs on any small Ubuntu server (22.04 or newer) that has Node.js 18+, [pm2](https://pm2.keymetrics.io) and PostgreSQL 13+, behind nginx. A 1 GB VPS is plenty, because your computer does the building and the server only runs the app (about 100 MB of memory).

Everything is one command, run on your computer from this repository:

```bash
./scripts/deploy.sh
```

The first time, it asks for the server (as you'd `ssh` to it, e.g. `root@203.0.113.7`) and your SSH key, and saves them in `.env.deploy`. Then it:
1. builds the app on your computer
2. on the server, creates a PostgreSQL database and user for Pennywise with a random password, and `/opt/pennywise` with its settings in `/opt/pennywise/.env`
3. applies the database migrations through an SSH tunnel, so the database never has to be reachable from the internet
4. asks you to choose the login password, if there isn't one yet
5. starts Pennywise with pm2 on `127.0.0.1:3200`, and only switches over once the new version answers
6. sets up a daily database backup

Run the same command to put a new version live. It backs up the database first, and if the new version doesn't start, the previous one stays live.

| Command | What it does |
|---|---|
| `./scripts/deploy.sh` | Build this checkout and put it live |
| `./scripts/deploy.sh password` | Change the login password |
| `./scripts/deploy.sh rollback` | Go back to the version before |
| `./scripts/deploy.sh restart` | Restart, e.g. after editing `/opt/pennywise/.env` |
| `./scripts/deploy.sh logs` | Show the app's log |
| `./scripts/deploy.sh backup` | Back up the database and download the file into `backups/` |

### nginx and HTTPS

Point nginx at `127.0.0.1:3200` and get a certificate with certbot:

```nginx
server {
    server_name money.example.com;
    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Clients must never set this Next.js internal header (CVE-2025-29927)
        proxy_set_header x-middleware-subrequest "";
        client_max_body_size 6m;
    }
}
```

```bash
certbot --nginx -d money.example.com
```

If pm2 isn't already set to start at boot, run `pm2 startup` once on the server (deploy.sh reminds you).

### Moving from the Docker install

Earlier versions of Pennywise ran in Docker with MariaDB in `/root/pennywise`. `./scripts/deploy.sh` finds that install and moves you off it in the same run:
1. it stops the old app, so nothing changes during the copy, and saves a last MariaDB backup in `/opt/pennywise/backups`
2. it copies every row into PostgreSQL in one transaction, reads each one back to check it arrived unchanged, and prints the balance of every account so you can compare them with what the app showed
3. your password, login sessions, time zone and other settings are carried over from the old `.env`
4. the new version starts on the same port, so nginx needs no change, and the old containers are stopped (not deleted)

If anything fails along the way, the old install is started again and the new database is emptied, so you can simply run the command again. Once you're happy, free the space the old install takes:

```bash
./scripts/deploy.sh remove-docker
```

### Backups

Every night `/opt/pennywise/backup.sh` saves the database to `/opt/pennywise/backups` and keeps two weeks of them, plus one before every update. To keep a copy on your computer:

```bash
./scripts/deploy.sh backup
```

Vultr's automatic backups or snapshots are a good second layer.

To restore a backup on the server, into an empty database:

```bash
pm2 stop pennywise
runuser -u postgres -- dropdb pennywise
runuser -u postgres -- createdb -O pennywise pennywise
gunzip -c /opt/pennywise/backups/pennywise-....sql.gz | runuser -u postgres -- psql -q pennywise
pm2 start pennywise
```

### Security notes

- Use a long password, at least 12 characters (the hash script enforces that). After 5 wrong attempts, an IP address is locked out for 15 minutes.
- Changing `SESSION_SECRET` logs out every session.
- Pennywise listens on `127.0.0.1` only; the database is reachable only from the server itself. Only root can read `/opt/pennywise/.env`.
- Apple Pay shortcut keys are stored as hashes. Revoke one on the Manage page if you lose the phone.

## Getting your transactions in

### 1. Add your accounts

On **Manage → Accounts**, add each account with the balance your bank shows today, for example:
- Chase checking (Checking, bank Chase)
- Discover it (Credit card, bank Discover, with what you owe)
- Capital One savings (Savings, bank Capital One), and each CD with its rate and maturity date
- Cash (Cash) for the bills in your wallet, and Venmo (Venmo, PayPal or Cash App, bank Venmo)

Filling in the **bank** name helps the importer recognize transfers, such as "DISCOVER E-PAYMENT" on your Chase statement. For cards you use with Apple Pay, enter the **Apple Wallet card name** exactly as Wallet shows it.

Also fill in **Your name at the bank** on the Manage page, as it appears on Zelle lines ("Zelle payment to YOUR NAME"). Zelle payments to and from yourself are then imported as transfers between your accounts instead of spending and income, and so are card lines that move money between your bank and your own Venmo.

### 2. Import statements

Download a statement and upload it on **Import**. For Chase checking, the CSV is the better choice: it includes the balance after every line, so Pennywise checks every day of the statement. Elsewhere QFX works best, because every line has an id, so re-importing overlapping date ranges never creates duplicates.

| Bank | Where | Format |
|---|---|---|
| Chase | Account → Download account activity | QFX or CSV |
| Discover | Activity → Download | QFX or CSV |
| Capital One 360 | Account → Download Transactions | QFX or CSV |
| Venmo | venmo.com → Statements → Download CSV | CSV |

Venmo payments funded straight from a bank card are left out, because they already appear on that card's statement as "VENMO PAYMENT". Payments from your Venmo balance are imported. If the importer misreads a CSV (for example card purchases shown as income), use **Change columns** in the preview. Your choice is remembered for that account.

After an import, Pennywise tells you whether the transactions add up to the statement's balances. If they don't, the account page shows the days where they stop adding up.

### 3. Log purchases from your iPhone

On **Manage → iPhone shortcuts**:
- **Set up Apple Pay** creates a key and walks you through a Shortcuts automation that sends the amount, merchant and card of each Apple Pay purchase to Pennywise.
- **Set up Log a purchase** walks you through a shortcut for everything Apple Pay doesn't see: the physical card at Walmart, cash at the farmers market. It asks how much, where, how you paid and the category, with your most used answers first, and tells you your spending money afterwards. Put it on the Action button or Back Tap so it's one press away.

Importing statements fills in the rest, and matches the purchases already logged instead of duplicating them. If the bank's amount is higher because of a tip, a split keeps the other people's shares and the tip goes to yours.

### Splits and people

Covered dinner for friends? In the + sheet, pick **Split**, give your share a category and add each person's share (or **Split evenly with…**). Only your share counts as spending; the rest shows up as **Owed to you** on Home and on the **People** page. When someone pays you back, log it (or edit their imported Zelle) as **Paid back**: it settles their share and isn't income.

People are created from Zelle and Venmo lines as you import. On the People page you can rename them and merge two spellings of the same person.

### 4. Check your balances now and then

On an account's page, tap **Check balance** and type what your bank shows. On the Cash account it's **Count cash**: if there's less than Pennywise expected, you can count the difference as cash you spent without logging it. If it matches, every transaction since the last check adds up. If not, Pennywise shows the difference and how many transactions came in since, so you can find the missing or different one. You can also save the bank's number with an **adjustment**, which makes the transactions add up without counting as spending. Home reminds you about accounts that haven't been checked in two weeks.

### 5. Sort what's left

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

### 6. Add Pennywise to the home screen

In Safari, open your Pennywise address, tap Share, then **Add to Home Screen**.

## Optional: AI sorting with Jev

[Jev](https://typesafe.ai) is TypeSafe AI's classification model. Pennywise asks it to pick one of your categories for merchants it hasn't seen you sort, and sends it your recent choices as examples.
- Jev's confidence decides what happens. At 80% or more, the category is filed automatically. Below that, the transaction goes to the Sort page with Jev's top guesses as the buttons.
- It's asked once per merchant per import, never for merchants you've already sorted, and never for transfers.
- At Jev's published price ($42 per billion input tokens) a year of transactions costs well under a cent.

To turn it on, create an API key at typesafe.ai, add it to `/opt/pennywise/.env` on the server as `TYPESAFE_API_KEY=your-key`, then run `./scripts/deploy.sh restart`.

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
| `./scripts/deploy.sh` | Put Pennywise on your server (see above) |

### Tests

`npm test` runs the unit tests. The database tests (import, accounts, sorting, Apple Pay capture, Plaid sync and server actions) run when `TEST_DATABASE_URL` points at a disposable database that has been migrated and seeded:

```bash
createdb pennywise_test
DATABASE_URL="postgresql://localhost/pennywise_test" npm run db:migrate
DATABASE_URL="postgresql://localhost/pennywise_test" npm run db:seed
TEST_DATABASE_URL="postgresql://localhost/pennywise_test" npm test
```

## Project layout

```
app/
  (auth)/login/           Password login
  (dashboard)/            Home, Transactions, Accounts, Reports, Sort, Import and Manage pages
    _actions/             Server actions (transactions, accounts, categories, sorting, Apple Pay keys, Plaid)
    _components/          Shared pieces: the add/edit sheet, transaction lists, Home, balance checks
    import/               Statement import page and actions
    accounts/             Account list and account pages
    reports/              Months and years
    review/               Sort page
    transactions/         Every transaction in one list
  api/                    Route handlers the pages read from; api/capture is the Apple Pay endpoint
  wizard/                 First-run currency setup
components/               Shared components and shadcn/ui
lib/
  auth.ts, session.ts     Login session
  ledger.ts               Balances, running balances and balance-check verification (no database)
  accounts.ts             Loads ledgers; account groups for Home
  classify.ts             What counts as spending or income, splits included (shared with the browser)
  reports.ts              Spending and income from transactions, by category, day and month
  entries.ts              Saving spending and income with a person and split lines
  people.ts, split.ts     People, what they owe you, and split arithmetic
  home.ts, accountPage.ts What Home and account pages show
  import/                 Statement parsing and matching
  categorize/             Category suggestions: your history, bank categories, keywords and Jev
  capture.ts              Apple Pay shortcut keys and card matching
  payee.ts                Normalizes merchant names to recognize repeat merchants
  plaid*.ts, crypto.ts    Optional Plaid sync
prisma/                   Schema, migrations and the category seed
scripts/
  deploy.sh               Builds on your computer and deploys over SSH
  server.sh               Its server side: database, pm2, backups, releases
  copy-from-mariadb.mjs   One-time copy from the old MariaDB install
  hash-password.mjs       Password hash helper
tests/                    Vitest tests and sample statements
```

Balances come from `lib/ledger.ts`: an account's balance is its latest `BalanceCheck` plus the transactions dated after it, and each pair of neighbouring checks verifies the transactions between them. Reports are computed straight from transactions by `lib/reports.ts`; whether money counts as spending or income follows its category, so money back in a spending category lowers it.
