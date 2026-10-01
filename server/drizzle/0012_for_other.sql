ALTER TABLE `settlements` ADD `i_paid_for_partner` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settlements` ADD `partner_paid_for_me` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `for_other` integer DEFAULT false NOT NULL;