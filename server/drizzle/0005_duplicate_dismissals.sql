CREATE TABLE `duplicate_dismissals` (
	`older_id` integer NOT NULL,
	`newer_id` integer NOT NULL,
	`dismissed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`older_id`, `newer_id`),
	FOREIGN KEY (`older_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`newer_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
