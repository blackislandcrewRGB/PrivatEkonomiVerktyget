CREATE TABLE `networth_snapshots` (
	`month` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`accounts_ore` integer NOT NULL,
	`securities_ore` integer NOT NULL,
	`cash_ore` integer NOT NULL,
	`partner_ore` integer NOT NULL,
	`cards_ore` integer NOT NULL,
	`other_debt_ore` integer NOT NULL,
	`csn_ore` integer NOT NULL,
	`illiquid_ore` integer NOT NULL,
	`net_ex_csn_ore` integer NOT NULL,
	`net_inc_csn_ore` integer NOT NULL,
	`estimated` integer DEFAULT false NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
