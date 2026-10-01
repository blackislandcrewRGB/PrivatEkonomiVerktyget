CREATE TABLE `price_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` integer NOT NULL,
	`date` text NOT NULL,
	`value` integer NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `price_series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_points_series_date_uq` ON `price_points` (`series_id`,`date`);--> statement-breakpoint
CREATE INDEX `price_points_date_idx` ON `price_points` (`date`);--> statement-breakpoint
CREATE TABLE `price_series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`source` text NOT NULL,
	`frequency` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_series_key_unique` ON `price_series` (`key`);