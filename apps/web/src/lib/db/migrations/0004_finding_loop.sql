ALTER TABLE `runs` ADD `purpose` text DEFAULT 'standard' NOT NULL;
--> statement-breakpoint
CREATE TABLE `agent_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`version` integer NOT NULL,
	`instructions` text NOT NULL,
	`allowed_tools` text NOT NULL,
	`grants` text NOT NULL,
	`inherited_prompt_block_ids` text NOT NULL,
	`created_by` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_versions_agent_version_idx` ON `agent_versions` (`agent_id`,`version`);
--> statement-breakpoint
CREATE TABLE `finding_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`finding_id` text NOT NULL,
	`target_agent_id` text NOT NULL,
	`source_run_id` text NOT NULL,
	`run_goal` text NOT NULL,
	`severity` text NOT NULL,
	`observed` text NOT NULL,
	`proposed_remediation` text DEFAULT '' NOT NULL,
	`reproduction` text NOT NULL,
	`hops` text DEFAULT '[]' NOT NULL,
	`delivered_to` text,
	`conversation` text DEFAULT '[]' NOT NULL,
	`proposal` text,
	`approval` text,
	`state` text DEFAULT 'open' NOT NULL,
	`escalation_reason` text,
	`round` integer DEFAULT 0 NOT NULL,
	`max_rounds` integer DEFAULT 3 NOT NULL,
	`budget_cap_usd` real NOT NULL,
	`spent_usd` real DEFAULT 0 NOT NULL,
	`applied_version` integer,
	`latest_retest_run_id` text,
	`retests` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_cases_finding_idx` ON `finding_cases` (`finding_id`);
--> statement-breakpoint
CREATE INDEX `finding_cases_target_idx` ON `finding_cases` (`target_agent_id`);
