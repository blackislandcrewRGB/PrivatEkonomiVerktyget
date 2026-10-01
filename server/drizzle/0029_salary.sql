CREATE TABLE `payslip_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payslip_id` integer NOT NULL,
	`position` integer NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`date_from` text,
	`date_to` text,
	`info` text,
	`quantity` real,
	`unit_price` integer,
	`amount` integer,
	FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payslip_lines_payslip_idx` ON `payslip_lines` (`payslip_id`);--> statement-breakpoint
CREATE TABLE `payslips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pay_date` text NOT NULL,
	`label_month` text,
	`work_month` text,
	`gross` integer NOT NULL,
	`tax` integer NOT NULL,
	`net` integer NOT NULL,
	`tax_basis` integer,
	`tax_table` integer,
	`tax_column` integer,
	`category` text,
	`salary_group` text,
	`hours_worked` real,
	`ytd_gross` integer,
	`ytd_tax` integer,
	`ytd_net` integer,
	`ytd_hours` real,
	`vacation_income_ytd` integer,
	`vacation_hourly_rate` integer,
	`vacation_earned` real,
	`atf_balance` real,
	`wellness_ytd` integer,
	`account_masked` text,
	`filename` text NOT NULL,
	`sha256` text NOT NULL,
	`imported_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payslips_pay_date_unique` ON `payslips` (`pay_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `payslips_sha256_unique` ON `payslips` (`sha256`);--> statement-breakpoint
CREATE TABLE `salary_constants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`valid_from` text NOT NULL,
	`monthly_salary` integer NOT NULL,
	`industry_supplement` integer DEFAULT 0 NOT NULL,
	`salary_supplement` integer DEFAULT 0 NOT NULL,
	`hours_per_month` real NOT NULL,
	`full_time_hours` real NOT NULL,
	`mertid_rate` integer NOT NULL,
	`vacation_hourly_rate` integer,
	`sources` text DEFAULT '{}' NOT NULL,
	`payslip_id` integer,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salary_constants_valid_from_unique` ON `salary_constants` (`valid_from`);--> statement-breakpoint
CREATE TABLE `salary_months` (
	`month` text PRIMARY KEY NOT NULL,
	`hours` real NOT NULL,
	`vacation_hours` real DEFAULT 0 NOT NULL,
	`atf_hours` real DEFAULT 0 NOT NULL,
	`overtime_pass_hours` real DEFAULT 0 NOT NULL,
	`ob_hours` text DEFAULT '{}' NOT NULL,
	`hours_mode` text DEFAULT 'manual' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tax_table_rows` (
	`year` integer NOT NULL,
	`table_no` integer NOT NULL,
	`kind` text NOT NULL,
	`income_from` integer NOT NULL,
	`income_to` integer NOT NULL,
	`columns` text NOT NULL,
	PRIMARY KEY(`year`, `table_no`, `kind`, `income_from`)
);
