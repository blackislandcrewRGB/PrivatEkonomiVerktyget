CREATE TABLE `bank_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`uid` text NOT NULL,
	`account_id` integer,
	`masked_ref` text,
	`name` text,
	`product` text,
	`currency` text,
	`last_booking_date` text,
	`last_sync_at` text,
	FOREIGN KEY (`connection_id`) REFERENCES `bank_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_accounts_connection_uid_uq` ON `bank_accounts` (`connection_id`,`uid`);--> statement-breakpoint
CREATE TABLE `bank_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`aspsp_name` text NOT NULL,
	`aspsp_country` text DEFAULT 'SE' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`state` text,
	`session_id` text,
	`valid_until` text,
	`authorized_at` text,
	`last_sync_at` text,
	`last_error` text,
	`last_error_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_pending` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bank_account_id` integer NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`description` text NOT NULL,
	`raw` text NOT NULL,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `imports` ADD `via` text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `entry_reference` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `bank_raw` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `match_key` text;--> statement-breakpoint
CREATE INDEX `transactions_account_match_idx` ON `transactions` (`account_id`,`match_key`);--> statement-breakpoint
CREATE INDEX `transactions_account_entry_idx` ON `transactions` (`account_id`,`entry_reference`);