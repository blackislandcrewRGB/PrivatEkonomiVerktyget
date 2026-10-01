CREATE TABLE `rent_notices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_id` integer,
	`recurring_expense_id` integer,
	`issuer` text NOT NULL,
	`number` text NOT NULL,
	`notice_date` text,
	`due_date` text NOT NULL,
	`rent_month` text NOT NULL,
	`period` text NOT NULL,
	`amount` integer NOT NULL,
	`lines` text DEFAULT '[]' NOT NULL,
	`bankgiro` text,
	`previous_amount` integer,
	`pdf` blob NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rent_notices_number_idx` ON `rent_notices` (`issuer`,`number`);--> statement-breakpoint
CREATE INDEX `rent_notices_expense_idx` ON `rent_notices` (`recurring_expense_id`,`period`);