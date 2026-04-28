CREATE TABLE `watchlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`name` varchar(100),
	`alertThreshold` int DEFAULT 80,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `watchlist_id` PRIMARY KEY(`id`),
	CONSTRAINT `watchlist_user_symbol` UNIQUE(`userId`,`symbol`)
);
--> statement-breakpoint
CREATE INDEX `idx_watchlist_user` ON `watchlist` (`userId`);