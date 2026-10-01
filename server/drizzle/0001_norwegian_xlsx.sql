CREATE TABLE `data_migrations` (
	`name` text PRIMARY KEY NOT NULL,
	`applied_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `merchant_category_map` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`category_id` integer,
	`times_seen` integer DEFAULT 0 NOT NULL,
	`last_seen_at` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_category_map_key_unique` ON `merchant_category_map` (`key`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `merchant_category` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `merchant_area` text;