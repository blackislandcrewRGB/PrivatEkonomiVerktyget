CREATE TABLE `reference_budget_category_map` (
	`category_id` integer PRIMARY KEY NOT NULL,
	`target` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reference_budget_expense_map` (
	`recurring_expense_id` integer PRIMARY KEY NOT NULL,
	`target` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE cascade
);
