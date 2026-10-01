CREATE TABLE `manual_balances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`amount_ore` integer NOT NULL,
	`value_date` text NOT NULL,
	`liquid` integer DEFAULT false NOT NULL,
	`recurring_expense_id` integer,
	`source` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE set null
);
