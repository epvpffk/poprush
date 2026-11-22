CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`nickname` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `results` (
	`room` text NOT NULL,
	`user` text NOT NULL,
	`outcome` text NOT NULL,
	`score` integer NOT NULL,
	`remaining` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`room`, `user`)
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL
);
