CREATE TABLE `recurring_expense_marks` (
	`recurring_expense_id` integer NOT NULL,
	`period` text NOT NULL,
	`marked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`recurring_expense_id`, `period`),
	FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `statements` ADD `paid_at` text;