ALTER TABLE `recurring_expenses` ADD `previous_account_id` integer REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `account_from` text;--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `last_period` text;