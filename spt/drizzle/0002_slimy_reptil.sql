ALTER TABLE `spt_class_events` ADD `recorded_at_client` text;--> statement-breakpoint
ALTER TABLE `spt_class_events` ADD `base_revision_id` text;--> statement-breakpoint
ALTER TABLE `spt_class_events` ADD `schema_version` integer;--> statement-breakpoint
ALTER TABLE `spt_entries` ADD `recorded_at_client` text;--> statement-breakpoint
ALTER TABLE `spt_entries` ADD `base_revision_id` text;--> statement-breakpoint
ALTER TABLE `spt_entries` ADD `schema_version` integer;