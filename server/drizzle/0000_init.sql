CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`balance_updated_at` text,
	`note` text,
	`kind` text DEFAULT 'bank' NOT NULL,
	`source` text,
	`account_ref` text,
	`import_hint` text,
	`manually_edited_at` text
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`color` text,
	`is_transfer` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_parent_uq` ON `categories` (`parent_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_top_name_uq` ON `categories` (`name`) WHERE "categories"."parent_id" IS NULL;--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`filename` text NOT NULL,
	`period_from` text,
	`period_to` text,
	`imported_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`rows_total` integer DEFAULT 0 NOT NULL,
	`rows_new` integer DEFAULT 0 NOT NULL,
	`rows_skipped` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `merchant_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pattern` text NOT NULL,
	`match_type` text DEFAULT 'contains' NOT NULL,
	`category_id` integer NOT NULL,
	`shared_default` integer,
	`is_transfer` integer DEFAULT false NOT NULL,
	`created_from` text DEFAULT 'manual' NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_rules_pattern_uq` ON `merchant_rules` (`match_type`,`pattern`);--> statement-breakpoint
CREATE TABLE `recurring_expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`day_of_month` integer,
	`payment_method` text NOT NULL,
	`account_id` integer,
	`shared` integer DEFAULT false NOT NULL,
	`category_id` integer,
	`link` text,
	`note` text,
	`paused` integer DEFAULT false NOT NULL,
	`billing_cycle` text DEFAULT 'monthly' NOT NULL,
	`manually_edited_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `recurring_income` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`day_of_month` integer NOT NULL,
	`account_id` integer,
	`active` integer DEFAULT true NOT NULL,
	`manually_edited_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`shared_total` integer NOT NULL,
	`partner_share` integer NOT NULL,
	`partner_paid` integer DEFAULT 0 NOT NULL,
	`balance` integer NOT NULL,
	`note` text,
	`settled_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_month_unique` ON `settlements` (`month`);--> statement-breakpoint
CREATE TABLE `statements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`period_from` text,
	`period_to` text,
	`due_date` text NOT NULL,
	`amount_due` integer NOT NULL,
	`min_payment` integer,
	`source` text NOT NULL,
	`import_id` integer,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `statements_account_due_idx` ON `statements` (`account_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`account_id` integer,
	`booking_date` text NOT NULL,
	`transaction_date` text,
	`description_raw` text NOT NULL,
	`description_clean` text NOT NULL,
	`counterparty` text,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'SEK' NOT NULL,
	`category_id` integer,
	`category_source` text DEFAULT 'none' NOT NULL,
	`category_confidence` real,
	`shared` integer DEFAULT false NOT NULL,
	`is_transfer` integer DEFAULT false NOT NULL,
	`card_masked` text,
	`fingerprint` text NOT NULL,
	`occurrence_index` integer DEFAULT 1 NOT NULL,
	`import_id` integer,
	`recurring_expense_id` integer,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`manually_edited_at` text,
	`deleted_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_fingerprint_occ_uq` ON `transactions` (`fingerprint`,`occurrence_index`);--> statement-breakpoint
CREATE INDEX `transactions_booking_date_idx` ON `transactions` (`booking_date`);--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_import_idx` ON `transactions` (`import_id`);--> statement-breakpoint
CREATE INDEX `transactions_account_idx` ON `transactions` (`account_id`);