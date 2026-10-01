ALTER TABLE `planned_items` ADD `account_id` integer REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `planned_items` ADD `shared` integer DEFAULT false NOT NULL;