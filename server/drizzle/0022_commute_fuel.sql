CREATE TABLE `fuel_prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`price` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fuel_prices_date_unique` ON `fuel_prices` (`date`);--> statement-breakpoint
CREATE TABLE `odometer_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`km` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `odometer_readings_date_unique` ON `odometer_readings` (`date`);--> statement-breakpoint
CREATE TABLE `work_shift_days` (
	`date` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_shifts` (
	`month` text PRIMARY KEY NOT NULL,
	`shifts` integer NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
