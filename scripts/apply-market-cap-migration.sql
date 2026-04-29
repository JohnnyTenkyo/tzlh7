-- Market Cap Cache Tables Migration
-- This script creates the market_cap_cache and market_cap_update_log tables

-- Drop existing tables if they exist (for idempotency)
DROP TABLE IF EXISTS `market_cap_update_log`;
DROP TABLE IF EXISTS `market_cap_cache`;

-- Create market_cap_cache table
CREATE TABLE `market_cap_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`marketCap` bigint,
	`currency` varchar(10) DEFAULT 'USD',
	`source` varchar(50) NOT NULL,
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `market_cap_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `market_cap_cache_symbol_unique` UNIQUE(`symbol`)
);

-- Create market_cap_update_log table
CREATE TABLE `market_cap_update_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`updateDate` varchar(10) NOT NULL,
	`totalSymbols` int NOT NULL,
	`successCount` int NOT NULL,
	`failureCount` int NOT NULL,
	`source` varchar(50) NOT NULL,
	`errorLog` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `market_cap_update_log_id` PRIMARY KEY(`id`)
);

-- Create indexes
CREATE INDEX `idx_source` ON `market_cap_cache` (`source`);
CREATE INDEX `idx_last_updated` ON `market_cap_cache` (`lastUpdated`);
CREATE INDEX `idx_update_date` ON `market_cap_update_log` (`updateDate`);
CREATE INDEX `idx_source_log` ON `market_cap_update_log` (`source`);
