CREATE TABLE `savings_holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `savings_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`holding_id` integer NOT NULL,
	`date` text NOT NULL,
	`value` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`holding_id`) REFERENCES `savings_holdings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `savings_values_holding_date_uq` ON `savings_values` (`holding_id`,`date`);