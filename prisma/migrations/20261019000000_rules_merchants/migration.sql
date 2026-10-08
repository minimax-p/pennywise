-- Rules and display names for merchants
-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "merchant" TEXT;

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pattern" TEXT,
    "personId" TEXT,
    "direction" TEXT,
    "categoryId" TEXT,
    "rename" TEXT,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rule_userId_idx" ON "Rule"("userId");

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A rule matches on a merchant, on text or on a person
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_kind" CHECK (
    ("kind" IN ('merchant', 'contains') AND "pattern" IS NOT NULL AND "pattern" <> '')
    OR ("kind" = 'person' AND "personId" IS NOT NULL));
