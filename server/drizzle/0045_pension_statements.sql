CREATE TABLE `pension_statements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`pensionable_income_ore` integer NOT NULL,
	`income_pension_right_ore` integer NOT NULL,
	`premium_pension_right_ore` integer NOT NULL,
	`source` text DEFAULT 'orange_envelope' NOT NULL,
	`entered_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pension_statements_year_unique` ON `pension_statements` (`year`);