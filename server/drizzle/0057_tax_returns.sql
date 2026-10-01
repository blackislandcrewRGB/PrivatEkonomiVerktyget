CREATE TABLE `tax_returns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`income_year` integer NOT NULL,
	`submitted_at` text,
	`employment_income` integer,
	`commute_deduction` integer,
	`isk_standard_income` integer,
	`capital_income` integer,
	`capital_expenses` integer,
	`source` text NOT NULL,
	`import_id` integer,
	`previous` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_returns_income_year_unique` ON `tax_returns` (`income_year`);