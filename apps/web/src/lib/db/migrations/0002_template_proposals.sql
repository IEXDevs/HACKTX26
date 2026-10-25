ALTER TABLE `agents` ADD `propose_templates` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `template_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_agent_id` text NOT NULL,
	`run_id` text,
	`name` text NOT NULL,
	`summary` text NOT NULL,
	`instructions` text NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`role` text NOT NULL,
	`complexity` text DEFAULT 'standard' NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`template_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `template_proposals_parent_idx` ON `template_proposals` (`parent_agent_id`);
