CREATE TABLE `spt_roster_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`body` text NOT NULL,
	`source_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `roster_revision_owner` ON `spt_roster_revisions` (`owner`);--> statement-breakpoint
ALTER TABLE `spt_sheet_settings` ADD `roster_revision_id` text DEFAULT '' NOT NULL;