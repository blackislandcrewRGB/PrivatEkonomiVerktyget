CREATE TABLE `settlements` (
	`month` text PRIMARY KEY NOT NULL,
	`i_paid` integer NOT NULL,
	`partner_paid` integer NOT NULL,
	`from_partner` integer NOT NULL,
	`to_partner` integer NOT NULL,
	`carry_in` integer NOT NULL,
	`result` integer NOT NULL,
	`note` text,
	`settled_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
