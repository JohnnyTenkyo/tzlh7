CREATE TABLE `market_cap_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`marketCap` bigint,
	`currency` varchar(10) DEFAULT 'USD',
	`source` varchar(50) NOT NULL,
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `market_cap_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `market_cap_cache_symbol_unique` UNIQUE(`symbol`),
	CONSTRAINT `idx_symbol` UNIQUE(`symbol`)
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX `idx_source` ON `market_cap_cache` (`source`);--> statement-breakpoint
CREATE INDEX `idx_last_updated` ON `market_cap_cache` (`lastUpdated`);--> statement-breakpoint
CREATE INDEX `idx_update_date` ON `market_cap_update_log` (`updateDate`);--> statement-breakpoint
CREATE INDEX `idx_source` ON `market_cap_update_log` (`source`);