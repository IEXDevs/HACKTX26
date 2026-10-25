ALTER TABLE `agents` ADD `team` text;
--> statement-breakpoint
UPDATE `agents` SET `team` = 'red' WHERE `id` = 'agt_red_team';
--> statement-breakpoint
UPDATE `agents` SET `team` = 'red', `rank` = 'grunt', `can_spawn_subagents` = 0, `propose_templates` = 0 WHERE `role` = 'security' AND `parent_agent_id` = 'agt_red_team';
--> statement-breakpoint
ALTER TABLE `finding_cases` ADD `crew` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `finding_cases` ADD `triage` text;
--> statement-breakpoint
ALTER TABLE `finding_cases` ADD `merged_finding_ids` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
INSERT INTO `agents` (`id`, `workspace_id`, `name`, `slug`, `role`, `rank`, `can_spawn_subagents`, `parent_agent_id`, `summary`, `instructions`, `inherited_prompt_block_ids`, `model_policy`, `grants`, `allowed_tools`, `complexity`, `max_steps`, `data_class`, `status`, `version`, `template_id`, `created_at`, `updated_at`, `default_goal`, `propose_templates`, `team`)
SELECT 'agt_blue_team', 'ws_astronom', 'Blue Team', 'blue-team', 'worker', 'intermediate', 1, NULL,
  'Repairs agents the red team broke: triages each finding, drafts one fix for a person to approve, and retests it.',
  'You lead the blue team and own the case queue: one active case per agent at a time. Do not triage, draft, or verify yourself. Hand each step to its own specialist: Triage, Fix Drafter, and Verifier. Each one is created for a single case and retires when the case closes. A fix reaches an agent only after a person approves that one change in the creator conversation, and the platform applies it. Once a fix is applied, start the retest with case.start_retest. Take design questions to the creator conversation. Never grant tools, never change an agent yourself, and never raise a budget.',
  '["pb_data_handling","pb_escalation"]',
  '{"mode":"auto","pinnedModelId":null,"costSensitivity":0.3,"latencySensitivity":0.2,"floorComplexity":"complex","deniedModelIds":[]}',
  '[]', '["case.read","case.start_retest"]', 'complex', 8, 'internal', 'active', 1, NULL,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000, '', 1, 'blue'
WHERE EXISTS (SELECT 1 FROM `workspaces` WHERE `id` = 'ws_astronom')
  AND NOT EXISTS (SELECT 1 FROM `agents` WHERE `id` = 'agt_blue_team')
  AND NOT EXISTS (SELECT 1 FROM `agents` WHERE `workspace_id` = 'ws_astronom' AND `slug` = 'blue-team');
--> statement-breakpoint
INSERT INTO `budget_policies` (`id`, `workspace_id`, `agent_id`, `period`, `limit_usd`, `warn_at`, `hard_stop`, `created_at`)
SELECT 'bp_blueteam_run', 'ws_astronom', 'agt_blue_team', 'run', 0.5, 0.8, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE EXISTS (SELECT 1 FROM `agents` WHERE `id` = 'agt_blue_team')
  AND NOT EXISTS (SELECT 1 FROM `budget_policies` WHERE `id` = 'bp_blueteam_run');
