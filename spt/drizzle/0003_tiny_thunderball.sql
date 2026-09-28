CREATE TABLE `spt_sheet_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`student_id` text NOT NULL,
	`class_date` text NOT NULL,
	`entry_id` text NOT NULL,
	`remote_id` text NOT NULL,
	`source_signature` text NOT NULL,
	`remote_revision` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sheet_receipt_owner_entry` ON `spt_sheet_receipts` (`owner`,`entry_id`);--> statement-breakpoint
CREATE INDEX `sheet_receipt_owner_student_day` ON `spt_sheet_receipts` (`owner`,`student_id`,`class_date`);--> statement-breakpoint
CREATE TABLE `spt_sheet_settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`mappings` text NOT NULL,
	`confirmed_at` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`last_sync_at` text,
	`last_error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spt_sheet_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`class_date` text NOT NULL,
	`content_hash` text NOT NULL,
	`body` text NOT NULL,
	`observed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sheet_snapshot_owner_day` ON `spt_sheet_snapshots` (`owner`,`class_date`);