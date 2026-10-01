CREATE TABLE `watch_findings` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`series` text,
	`amount` integer,
	`date` text,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`dismissed_at` text,
	`accepted_at` text
);
--> statement-breakpoint
CREATE INDEX `watch_findings_series_idx` ON `watch_findings` (`series`);