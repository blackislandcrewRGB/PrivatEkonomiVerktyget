CREATE TABLE `transaction_splits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `transaction_splits_tx_idx` ON `transaction_splits` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `transaction_splits_category_idx` ON `transaction_splits` (`category_id`);