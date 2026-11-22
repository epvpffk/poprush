CREATE TABLE `ai_results` (
	`room` text NOT NULL,
	`user` text NOT NULL,
	`bot` text NOT NULL,
	`level` integer NOT NULL,
	`outcome` text NOT NULL,
	`score` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`room`, `user`, `bot`)
);
--> statement-breakpoint
CREATE INDEX `ai_results_user_level` ON `ai_results` (`user`,`level`);