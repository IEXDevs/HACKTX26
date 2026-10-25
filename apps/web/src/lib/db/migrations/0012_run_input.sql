CREATE TABLE `input_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `run_id` text NOT NULL REFERENCES `runs`(`id`) ON DELETE CASCADE,
  `agent_id` text NOT NULL,
  `call_id` text NOT NULL,
  `question` text NOT NULL,
  `reason` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `answer` text,
  `answered_by` text,
  `requested_at` integer NOT NULL,
  `answered_at` integer
);
--> statement-breakpoint
CREATE INDEX `input_requests_workspace_status_idx` ON `input_requests` (`workspace_id`, `status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `input_requests_run_call_idx` ON `input_requests` (`run_id`, `call_id`);
--> statement-breakpoint
CREATE TABLE `run_checkpoints` (
  `run_id` text PRIMARY KEY NOT NULL REFERENCES `runs`(`id`) ON DELETE CASCADE,
  `state` text NOT NULL,
  `updated_at` integer NOT NULL
);
