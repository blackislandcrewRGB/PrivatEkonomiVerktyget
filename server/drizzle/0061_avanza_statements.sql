CREATE TABLE `avanza_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`amount_ore` integer NOT NULL,
	`balance_ore` integer NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `avanza_statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `avanza_movements_statement_idx` ON `avanza_movements` (`statement_id`);--> statement-breakpoint
CREATE TABLE `avanza_statements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account` text NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`opening_ore` integer NOT NULL,
	`closing_ore` integer NOT NULL,
	`imported_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `avanza_statements_account_from_uq` ON `avanza_statements` (`account`,`period_from`);