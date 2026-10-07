-- Balance checks replace the single balance stored on each account
CREATE TABLE `BalanceCheck` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `balance` DOUBLE NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BalanceCheck_accountId_date_idx`(`accountId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BalanceCheck` ADD CONSTRAINT `BalanceCheck_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Each account's stored balance becomes its first check, with the same date, so
-- every balance stays exactly the same (the check plus transactions dated after it)
INSERT INTO `BalanceCheck` (`id`, `accountId`, `date`, `balance`, `source`, `createdAt`)
SELECT UUID(), `id`, `knownBalanceDate`, `knownBalance`, 'you', CURRENT_TIMESTAMP(3) FROM `Account`;

ALTER TABLE `Account` DROP COLUMN `knownBalance`,
    DROP COLUMN `knownBalanceDate`,
    ADD COLUMN `apy` DOUBLE NULL,
    ADD COLUMN `maturesOn` DATETIME(3) NULL;

ALTER TABLE `UserSettings` ADD COLUMN `selfNames` VARCHAR(191) NULL;

ALTER TABLE `Transaction` ADD COLUMN `note` VARCHAR(500) NULL;

-- Reports are computed from transactions, so the running totals are no longer kept
DROP TABLE `MonthHistory`;

DROP TABLE `YearHistory`;
