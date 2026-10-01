DROP TABLE `settlements`;--> statement-breakpoint
ALTER TABLE `transactions` ADD `paid_by` text DEFAULT 'me' NOT NULL;