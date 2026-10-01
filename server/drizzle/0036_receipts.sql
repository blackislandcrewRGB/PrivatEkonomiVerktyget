CREATE TABLE `receipt_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_id` integer NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`quantity_milli` integer,
	`unit` text,
	`unit_price_ore` integer,
	`total_ore` integer NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `receipt_lines_receipt_idx` ON `receipt_lines` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipt_lines_name_key_idx` ON `receipt_lines` (`name_key`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer,
	`store` text NOT NULL,
	`store_area` text,
	`purchase_date` text NOT NULL,
	`purchase_time` text,
	`total_ore` integer NOT NULL,
	`stated_item_count` integer,
	`source` text NOT NULL,
	`raw_text` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `receipts_transaction_idx` ON `receipts` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `receipts_purchase_date_idx` ON `receipts` (`purchase_date`);