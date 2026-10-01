CREATE TABLE `item_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`kind` text NOT NULL,
	`file_path` text NOT NULL,
	`original_filename` text,
	`thumbnail_path` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_attachments_item_idx` ON `item_attachments` (`item_id`);--> statement-breakpoint
CREATE TABLE `item_transactions` (
	`item_id` integer NOT NULL,
	`transaction_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`item_id`, `transaction_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_transactions_tx_idx` ON `item_transactions` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`purchase_date` text NOT NULL,
	`price_ore` integer NOT NULL,
	`merchant` text,
	`purchase_url` text,
	`note` text,
	`owner` text DEFAULT 'me' NOT NULL,
	`status` text DEFAULT 'owned' NOT NULL,
	`warranty_months` integer,
	`return_deadline` text,
	`sold_price_ore` integer,
	`sold_date` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `items_purchase_date_idx` ON `items` (`purchase_date`);--> statement-breakpoint
CREATE INDEX `items_status_idx` ON `items` (`status`);