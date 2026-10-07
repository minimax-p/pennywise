-- People, split lines and wallet accounts
-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "personId" TEXT;

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionLine" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "categoryId" TEXT,
    "personId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TransactionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_userId_name_key" ON "Person"("userId", "name");

-- CreateIndex
CREATE INDEX "TransactionLine_transactionId_idx" ON "TransactionLine"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionLine_categoryId_idx" ON "TransactionLine"("categoryId");

-- CreateIndex
CREATE INDEX "TransactionLine_personId_idx" ON "TransactionLine"("personId");

-- CreateIndex
CREATE INDEX "Transaction_personId_idx" ON "Transaction"("personId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionLine" ADD CONSTRAINT "TransactionLine_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionLine" ADD CONSTRAINT "TransactionLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionLine" ADD CONSTRAINT "TransactionLine_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A line is either your share in a category or someone else's share, never both
ALTER TABLE "TransactionLine" ADD CONSTRAINT "TransactionLine_category_or_person"
    CHECK (("categoryId" IS NULL) <> ("personId" IS NULL));
ALTER TABLE "TransactionLine" ADD CONSTRAINT "TransactionLine_amount_positive" CHECK ("amount" > 0);

-- Venmo, PayPal and Cash App balances become wallets, so "cash" means bills and coins and
-- ATM withdrawals know where to go
UPDATE "Account" SET "type" = 'wallet'
WHERE "type" = 'cash'
  AND (COALESCE("institution", '') || ' ' || "name") ~* '(venmo|paypal|cash ?app|apple cash)';
