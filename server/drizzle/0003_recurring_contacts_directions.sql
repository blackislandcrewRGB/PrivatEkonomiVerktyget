CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`counterparty` text NOT NULL,
	`name` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_counterparty_unique` ON `contacts` (`counterparty`);--> statement-breakpoint
DROP INDEX `merchant_rules_pattern_uq`;--> statement-breakpoint
ALTER TABLE `merchant_rules` ADD `direction` text DEFAULT 'any' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_rules_pattern_dir_uq` ON `merchant_rules` (`match_type`,`pattern`,`direction`);--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `yearly_available` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `bound_until` text;