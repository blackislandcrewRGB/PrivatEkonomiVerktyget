CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `clearing` text;--> statement-breakpoint
ALTER TABLE `merchant_rules` ADD `counter_account_id` integer REFERENCES accounts(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `match_pattern` text;--> statement-breakpoint
ALTER TABLE `recurring_income` ADD `match_pattern` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `recurring_income_id` integer REFERENCES recurring_income(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `counter_ref` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `counter_account_id` integer REFERENCES accounts(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `transfer_pair_id` integer;--> statement-breakpoint
CREATE INDEX `transactions_transfer_pair_idx` ON `transactions` (`transfer_pair_id`);