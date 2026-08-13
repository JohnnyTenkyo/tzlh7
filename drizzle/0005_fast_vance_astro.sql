CREATE TABLE `scan_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('running','done','error','cancelled') NOT NULL DEFAULT 'running',
	`progress` int NOT NULL DEFAULT 0,
	`total` int NOT NULL DEFAULT 0,
	`currentSymbol` varchar(20),
	`strategies` json,
	`message` text,
	`resultCount` int DEFAULT 0,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scan_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_scan_jobs_user_created` ON `scan_jobs` (`userId`,`createdAt`);