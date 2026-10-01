CREATE TABLE `recurring_income_overrides` (
	`recurring_income_id` integer NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	PRIMARY KEY(`recurring_income_id`, `month`),
	FOREIGN KEY (`recurring_income_id`) REFERENCES `recurring_income`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `label` text;