-- AlterTable
ALTER TABLE `Transaction` ADD COLUMN `aiSuggestions` JSON NULL,
    ADD COLUMN `categorizedBy` VARCHAR(191) NULL,
    ADD COLUMN `categoryConfidence` DOUBLE NULL,
    ADD COLUMN `needsReview` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `Transaction_userId_needsReview_idx` ON `Transaction`(`userId`, `needsReview`);


-- Transactions filed under Unsorted start out on the Sort page
UPDATE `Transaction` t
JOIN `Category` c ON c.`id` = t.`categoryId`
SET t.`needsReview` = true
WHERE c.`name` = 'Unsorted' AND t.`type` IN ('income', 'expense');
