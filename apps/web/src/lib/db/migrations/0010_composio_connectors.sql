ALTER TABLE `agents` ADD `allowed_connectors` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `operator_user_id` text;
--> statement-breakpoint
CREATE TABLE `connected_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`toolkit` text NOT NULL,
	`toolkit_name` text NOT NULL,
	`composio_account_id` text,
	`auth_config_id` text,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`last_sync_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connected_accounts_user_toolkit_idx` ON `connected_accounts` (`workspace_id`,`user_id`,`toolkit`);
--> statement-breakpoint
CREATE TABLE `connector_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`toolkit` text NOT NULL,
	`granted_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_grants_agent_toolkit_idx` ON `connector_grants` (`agent_id`,`toolkit`);
--> statement-breakpoint
CREATE TABLE `workspace_contexts` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `connector_catalog` (
	`toolkit` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`logo_url` text,
	`category` text,
	`auth_schemes` text DEFAULT '[]' NOT NULL,
	`popular` integer DEFAULT false NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
DELETE FROM `credentials` WHERE `id` IN ('cred_github','cred_datadog','cred_okta');
--> statement-breakpoint
DELETE FROM `connectors` WHERE `id` IN ('con_github','con_datadog','con_kb','con_okta','con_web');
