CREATE TABLE `recurring_expense_amounts` (
	`recurring_expense_id` integer NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	PRIMARY KEY(`recurring_expense_id`, `month`),
	FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE cascade
);
