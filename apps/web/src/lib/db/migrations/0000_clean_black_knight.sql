CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`role` text NOT NULL,
	`parent_agent_id` text,
	`summary` text DEFAULT '' NOT NULL,
	`instructions` text NOT NULL,
	`inherited_prompt_block_ids` text DEFAULT '[]' NOT NULL,
	`model_policy` text NOT NULL,
	`grants` text DEFAULT '[]' NOT NULL,
	`allowed_tools` text DEFAULT '[]' NOT NULL,
	`complexity` text DEFAULT 'standard' NOT NULL,
	`max_steps` integer DEFAULT 12 NOT NULL,
	`data_class` text DEFAULT 'internal' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`template_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_workspace_slug_idx` ON `agents` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `agents_parent_idx` ON `agents` (`parent_agent_id`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`call_id` text,
	`resource` text NOT NULL,
	`scopes` text NOT NULL,
	`risk` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`note` text,
	`requested_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `approvals_status_idx` ON `approvals` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_workspace_idx` ON `audit_log` (`workspace_id`,`at`);--> statement-breakpoint
CREATE TABLE `budget_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text,
	`period` text NOT NULL,
	`limit_usd` real NOT NULL,
	`warn_at` real DEFAULT 0.8 NOT NULL,
	`hard_stop` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`last_sync_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`connector_id` text,
	`name` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`hint` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`rotated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `eval_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`suite_id` text NOT NULL,
	`run_id` text,
	`status` text NOT NULL,
	`tool_call_accuracy` real DEFAULT 0 NOT NULL,
	`task_success` real DEFAULT 0 NOT NULL,
	`intervention_rate` real DEFAULT 0 NOT NULL,
	`cases_passed` integer DEFAULT 0 NOT NULL,
	`cases_total` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `eval_runs_suite_idx` ON `eval_runs` (`suite_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `eval_suites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cases` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text,
	`scope` text DEFAULT 'workspace' NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`importance` real DEFAULT 0.5 NOT NULL,
	`source_run_id` text,
	`created_at` integer NOT NULL,
	`last_recalled_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memories_workspace_idx` ON `memories` (`workspace_id`,`scope`);--> statement-breakpoint
CREATE TABLE `prompt_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`level` text NOT NULL,
	`content` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`ts` integer NOT NULL,
	`type` text NOT NULL,
	`agent_id` text,
	`hash` text NOT NULL,
	`prev_hash` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_run_seq_idx` ON `run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `run_events_type_idx` ON `run_events` (`type`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`trigger_id` text,
	`goal` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`data_class` text DEFAULT 'internal' NOT NULL,
	`budget_usd` real NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`failure_reason` text,
	`mode` text DEFAULT 'live' NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`event_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_workspace_started_idx` ON `runs` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `runs_agent_idx` ON `runs` (`agent_id`);--> statement-breakpoint
CREATE TABLE `security_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`target_agent_id` text,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`evidence` text,
	`remediation` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `findings_workspace_idx` ON `security_findings` (`workspace_id`,`severity`);--> statement-breakpoint
CREATE TABLE `task_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`status` text NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_log_workspace_idx` ON `task_log` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`outcome` text NOT NULL,
	`graph` text NOT NULL,
	`required_connectors` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`estimated_minutes` integer DEFAULT 5 NOT NULL,
	`builtin` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_key_idx` ON `templates` (`key`);--> statement-breakpoint
CREATE TABLE `triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`kind` text NOT NULL,
	`cron` text,
	`event_filter` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'engineer' NOT NULL,
	`avatar_hue` integer DEFAULT 90 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`default_data_class` text DEFAULT 'internal' NOT NULL,
	`denied_model_ids` text DEFAULT '[]' NOT NULL,
	`default_run_budget_usd` real DEFAULT 2.5 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);