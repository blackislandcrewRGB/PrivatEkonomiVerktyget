ALTER TABLE `recurring_expenses` ADD `currency` text;--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `foreign_amount` integer;--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `vat_percent` integer;