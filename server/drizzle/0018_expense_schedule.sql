ALTER TABLE `recurring_expenses` ADD `schedule_type` text DEFAULT 'day_of_month' NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `anchor_day` integer;--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `bank_day_rule` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `date_basis` text DEFAULT 'booking' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `foreign_amount` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `foreign_currency` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `exchange_rate` real;--> statement-breakpoint
-- Existing expenses: a fixed day (the old day_of_month), no bank-day rule;
-- card charges are compared on the transaction day, the rest on the booking day.
UPDATE `recurring_expenses` SET `anchor_day` = `day_of_month`;--> statement-breakpoint
UPDATE `recurring_expenses` SET `date_basis` = 'transaction'
  WHERE `payment_method` IN ('card', 'credit_card')
     OR `account_id` IN (SELECT `id` FROM `accounts` WHERE `kind` = 'credit_card');
