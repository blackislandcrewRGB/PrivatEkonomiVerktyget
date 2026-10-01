ALTER TABLE `categories` ADD `system_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_system_key_uq` ON `categories` (`system_key`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `private` integer DEFAULT false NOT NULL;