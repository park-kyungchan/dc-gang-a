CREATE TABLE `spt_audio_import_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`import_id` text NOT NULL,
	`seq` integer NOT NULL,
	`size` integer NOT NULL,
	`hash` text NOT NULL,
	`object_key` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `spt_audio_imports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_parts_sequence` ON `spt_audio_import_parts` (`import_id`,`seq`);--> statement-breakpoint
CREATE TABLE `spt_audio_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`session_id` text NOT NULL,
	`filename` text,
	`mime` text,
	`size` integer,
	`status` text DEFAULT 'prepared' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`duration` real,
	`attempt_id` text,
	`transcript_id` text,
	`error` text,
	FOREIGN KEY (`session_id`) REFERENCES `spt_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `imports_owner_session` ON `spt_audio_imports` (`owner`,`session_id`);