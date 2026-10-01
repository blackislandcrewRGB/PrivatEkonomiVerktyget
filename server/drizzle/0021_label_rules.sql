CREATE TABLE `label_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pattern` text NOT NULL,
	`match_type` text DEFAULT 'contains' NOT NULL,
	`label` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `label_rules_pattern_uq` ON `label_rules` (`match_type`,`pattern`);