CREATE TABLE `spt_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`session_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `spt_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `captures_session` ON `spt_captures` (`owner`,`session_id`);--> statement-breakpoint
CREATE TABLE `spt_audio_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`capture_id` text NOT NULL,
	`seq` integer NOT NULL,
	`size` integer NOT NULL,
	`hash` text NOT NULL,
	`object_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`capture_id`) REFERENCES `spt_captures`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chunks_capture_seq` ON `spt_audio_chunks` (`capture_id`,`seq`);--> statement-breakpoint
CREATE TABLE `spt_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`capture_id` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `spt_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entries_session` ON `spt_entries` (`owner`,`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `spt_secrets` (
	`owner` text PRIMARY KEY NOT NULL,
	`cipher` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spt_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`student_id` text NOT NULL,
	`class_date` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_owner_day` ON `spt_sessions` (`owner`,`class_date`);