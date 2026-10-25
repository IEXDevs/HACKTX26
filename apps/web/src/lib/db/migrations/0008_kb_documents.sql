CREATE TABLE `kb_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`data_class` text DEFAULT 'internal' NOT NULL,
	`body` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kb_documents_workspace_idx` ON `kb_documents` (`workspace_id`);
