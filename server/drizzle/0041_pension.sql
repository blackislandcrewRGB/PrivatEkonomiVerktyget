CREATE TABLE `pension_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`amount_ore` integer NOT NULL,
	`value_date` text NOT NULL,
	`placeable` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`monthly_premium_ore` integer,
	`premium_date` text,
	`payout_from_age` integer,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `pension_funds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`fund_name` text NOT NULL,
	`amount_ore` integer NOT NULL,
	`units_e4` integer NOT NULL,
	`nav_ore` integer NOT NULL,
	`value_date` text NOT NULL,
	`fee_pct_e4` integer,
	`region` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `pension_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pension_funds_entry_idx` ON `pension_funds` (`entry_id`);