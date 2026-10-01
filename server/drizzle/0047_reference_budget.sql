CREATE TABLE `reference_budget_adjustments` (
	`year` integer NOT NULL,
	`item_key` text NOT NULL,
	`condition` text NOT NULL,
	`amount_ore` integer NOT NULL,
	`note` text,
	PRIMARY KEY(`year`, `item_key`, `condition`),
	FOREIGN KEY (`year`) REFERENCES `reference_budget_years`(`year`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reference_budget_amounts` (
	`year` integer NOT NULL,
	`item_key` text NOT NULL,
	`bracket` text NOT NULL,
	`amount_ore` integer NOT NULL,
	PRIMARY KEY(`year`, `item_key`, `bracket`),
	FOREIGN KEY (`year`) REFERENCES `reference_budget_years`(`year`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reference_budget_items` (
	`year` integer NOT NULL,
	`key` text NOT NULL,
	`scope` text NOT NULL,
	`choice` text,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`year`, `key`),
	FOREIGN KEY (`year`) REFERENCES `reference_budget_years`(`year`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reference_budget_years` (
	`year` integer PRIMARY KEY NOT NULL,
	`source_title` text NOT NULL,
	`source_url` text NOT NULL,
	`note` text,
	`age_groups` text NOT NULL,
	`household_sizes` text NOT NULL,
	`source_hash` text NOT NULL,
	`loaded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
