CREATE TABLE `ai_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` varchar(50) NOT NULL,
	`apiEndpoint` varchar(500) NOT NULL,
	`apiKey` varchar(500) NOT NULL,
	`model` varchar(100) NOT NULL,
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_user_provider` UNIQUE(`userId`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `backtest_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`strategy` enum('standard','aggressive','ladder_cd_combo','mean_reversion','macd_volume','bollinger_squeeze','gemini_ai','vamr','ravts','rsi_reversal','macd_divergence') NOT NULL,
	`strategyParams` json,
	`status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
	`symbols` json NOT NULL,
	`startDate` varchar(10) NOT NULL,
	`endDate` varchar(10) NOT NULL,
	`initialCapital` decimal(15,2) NOT NULL DEFAULT '100000',
	`maxPositionPct` decimal(5,2) NOT NULL DEFAULT '10',
	`totalReturn` decimal(15,4),
	`totalReturnPct` decimal(10,4),
	`winRate` decimal(5,4),
	`maxDrawdown` decimal(10,4),
	`sharpeRatio` decimal(10,4),
	`totalTrades` int,
	`winningTrades` int,
	`losingTrades` int,
	`benchmarkReturn` decimal(10,4),
	`totalCommissionFee` decimal(15,2) DEFAULT '0',
	`totalPlatformFee` decimal(15,2) DEFAULT '0',
	`progress` int DEFAULT 0,
	`progressMessage` text,
	`resultSummary` json,
	`aiAnalysis` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `backtest_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backtest_trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`quantity` decimal(15,4) NOT NULL,
	`price` decimal(15,4) NOT NULL,
	`totalAmount` decimal(15,2) NOT NULL,
	`fee` decimal(10,4) DEFAULT '0',
	`commissionFee` decimal(15,2) DEFAULT '0',
	`platformFee` decimal(15,2) DEFAULT '0',
	`reason` text,
	`signalType` varchar(50),
	`tradeTime` bigint NOT NULL,
	`pnl` decimal(15,2),
	`pnlPct` decimal(10,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backtest_trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cache_metadata` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` varchar(10) NOT NULL,
	`oldestDate` varchar(30),
	`newestDate` varchar(30),
	`candleCount` int DEFAULT 0,
	`lastUpdated` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`status` enum('empty','partial','complete') DEFAULT 'empty',
	CONSTRAINT `cache_metadata_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_cm_symbol_tf` UNIQUE(`symbol`,`timeframe`)
);
--> statement-breakpoint
CREATE TABLE `custom_data_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`provider` varchar(50) NOT NULL,
	`apiEndpoint` varchar(500),
	`apiKey` varchar(500),
	`description` text,
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `custom_data_sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `data_source_health` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source` varchar(30) NOT NULL,
	`timeframe` varchar(10) NOT NULL,
	`successCount` int DEFAULT 0,
	`failCount` int DEFAULT 0,
	`lastSuccess` timestamp,
	`lastFail` timestamp,
	`lastError` text,
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `data_source_health_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_dsh_source_tf` UNIQUE(`source`,`timeframe`)
);
--> statement-breakpoint
CREATE TABLE `data_source_priority` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sourceOrder` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `data_source_priority_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_user_id` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `excluded_symbols` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`reason` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `excluded_symbols_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_user_symbol` UNIQUE(`userId`,`symbol`)
);
--> statement-breakpoint
CREATE TABLE `historical_candle_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` varchar(10) NOT NULL,
	`date` varchar(30) NOT NULL,
	`open` decimal(15,4) NOT NULL,
	`high` decimal(15,4) NOT NULL,
	`low` decimal(15,4) NOT NULL,
	`close` decimal(15,4) NOT NULL,
	`volume` bigint DEFAULT 0,
	CONSTRAINT `historical_candle_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_symbol_tf_date` UNIQUE(`symbol`,`timeframe`,`date`)
);
--> statement-breakpoint
CREATE TABLE `scan_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scanDate` varchar(10) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`strategy` varchar(50) NOT NULL,
	`signalType` enum('buy','sell','hold') NOT NULL DEFAULT 'hold',
	`score` int NOT NULL DEFAULT 0,
	`rsi` varchar(20),
	`macdHistogram` varchar(20),
	`ladderGap` varchar(20),
	`bbPosition` varchar(20),
	`volumeRatio` varchar(20),
	`signals` text,
	`trend` enum('up','down','neutral') DEFAULT 'neutral',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scan_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_warming_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`sectors` json,
	`marketCapTiers` json,
	`customSymbols` json,
	`cronExpression` varchar(100) NOT NULL,
	`isEnabled` boolean DEFAULT true,
	`lastExecutedAt` timestamp,
	`nextExecutedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduled_warming_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `warming_progress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`taskId` varchar(64) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`status` enum('pending','success','failed') NOT NULL DEFAULT 'pending',
	`dataSource` varchar(30),
	`errorMessage` text,
	`duration` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `warming_progress_id` PRIMARY KEY(`id`),
	CONSTRAINT `warming_progress_taskId_unique` UNIQUE(`taskId`)
);
--> statement-breakpoint
CREATE TABLE `warming_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`dataSource` varchar(30) NOT NULL,
	`successCount` int DEFAULT 0,
	`failCount` int DEFAULT 0,
	`totalDuration` bigint DEFAULT 0,
	`averageDuration` decimal(10,2) DEFAULT '0',
	`lastUpdated` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `warming_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_user_source` UNIQUE(`userId`,`dataSource`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);--> statement-breakpoint
CREATE INDEX `idx_user_active` ON `ai_configs` (`userId`,`isActive`);--> statement-breakpoint
CREATE INDEX `idx_session` ON `backtest_trades` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_user_id` ON `custom_data_sources` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_user_active` ON `custom_data_sources` (`userId`,`isActive`);--> statement-breakpoint
CREATE INDEX `idx_created` ON `data_source_priority` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_user_id` ON `excluded_symbols` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_symbol_tf` ON `historical_candle_cache` (`symbol`,`timeframe`);--> statement-breakpoint
CREATE INDEX `idx_user_id` ON `scheduled_warming_tasks` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_enabled` ON `scheduled_warming_tasks` (`isEnabled`);--> statement-breakpoint
CREATE INDEX `idx_next_executed` ON `scheduled_warming_tasks` (`nextExecutedAt`);--> statement-breakpoint
CREATE INDEX `idx_task_id` ON `warming_progress` (`taskId`);--> statement-breakpoint
CREATE INDEX `idx_user_id` ON `warming_progress` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_status` ON `warming_progress` (`status`);