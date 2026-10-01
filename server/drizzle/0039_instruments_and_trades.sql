CREATE TABLE `cash_balances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account` text NOT NULL,
	`date` text NOT NULL,
	`amount_ore` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_balances_account_date_uq` ON `cash_balances` (`account`,`date`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pair` text NOT NULL,
	`date` text NOT NULL,
	`rate_e6` integer NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rates_pair_date_uq` ON `fx_rates` (`pair`,`date`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`isin` text,
	`currency` text NOT NULL,
	`kind` text NOT NULL,
	`zone` text NOT NULL,
	`ticker_yahoo` text,
	`ticker_avanza` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `instruments_zone_idx` ON `instruments` (`zone`);--> statement-breakpoint
CREATE TABLE `price_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instrument_id` integer NOT NULL,
	`date` text NOT NULL,
	`price_e4` integer NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_snapshots_instrument_date_uq` ON `price_snapshots` (`instrument_id`,`date`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instrument_id` integer NOT NULL,
	`account` text NOT NULL,
	`side` text NOT NULL,
	`date` text NOT NULL,
	`quantity_e4` integer NOT NULL,
	`price_e4` integer NOT NULL,
	`fee_ore` integer DEFAULT 0 NOT NULL,
	`fx_rate_e6` integer,
	`transaction_id` integer,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `trades_instrument_idx` ON `trades` (`instrument_id`);--> statement-breakpoint
CREATE INDEX `trades_date_idx` ON `trades` (`date`);