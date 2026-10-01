CREATE TABLE `fuel_fills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer,
	`date` text NOT NULL,
	`litres_e2` integer NOT NULL,
	`list_price_ore` integer NOT NULL,
	`discount_ore` integer DEFAULT 0 NOT NULL,
	`amount_ore` integer NOT NULL,
	`station` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fuel_fills_transaction_id_unique` ON `fuel_fills` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `fuel_fills_date_idx` ON `fuel_fills` (`date`);