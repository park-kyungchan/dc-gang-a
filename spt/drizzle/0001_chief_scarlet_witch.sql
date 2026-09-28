CREATE TABLE `spt_class_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`entity_id` text NOT NULL,
	`student_id` text NOT NULL,
	`class_date` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `class_events_owner_entity` ON `spt_class_events` (`owner`,`entity_id`);--> statement-breakpoint
CREATE INDEX `class_events_owner_day` ON `spt_class_events` (`owner`,`class_date`);--> statement-breakpoint
ALTER TABLE `spt_sessions` ADD `purpose` text DEFAULT 'lesson' NOT NULL;--> statement-breakpoint
ALTER TABLE `spt_sessions` ADD `ended_at` text;