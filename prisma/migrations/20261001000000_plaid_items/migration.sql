-- AlterTable
ALTER TABLE `Transaction` ADD COLUMN `plaidItemId` VARCHAR(191) NULL,
    ADD COLUMN `plaidTransactionId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `PlaidItem` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `accessToken` TEXT NOT NULL,
    `institutionId` VARCHAR(191) NULL,
    `institutionName` VARCHAR(191) NULL,
    `cursor` TEXT NULL,
    `error` VARCHAR(191) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlaidItem_itemId_key`(`itemId`),
    INDEX `PlaidItem_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Transaction_plaidTransactionId_key` ON `Transaction`(`plaidTransactionId`);

-- CreateIndex
CREATE INDEX `Transaction_userId_date_idx` ON `Transaction`(`userId`, `date`);

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_plaidItemId_fkey` FOREIGN KEY (`plaidItemId`) REFERENCES `PlaidItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

