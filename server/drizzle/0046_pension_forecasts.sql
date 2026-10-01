CREATE TABLE `pension_forecasts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`made_on` text NOT NULL,
	`retirement_age` integer NOT NULL,
	`monthly_pension_ore` integer NOT NULL,
	`assumptions` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pension_forecasts_made_on_age_uq` ON `pension_forecasts` (`made_on`,`retirement_age`);