CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username_unique` ON `accounts` (`username`);--> statement-breakpoint
CREATE TABLE `auth_rates` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `solo_results` (
	`run` text NOT NULL,
	`user` text NOT NULL,
	`score` integer NOT NULL,
	`remaining` integer NOT NULL,
	`elapsed` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`run`, `user`)
);
