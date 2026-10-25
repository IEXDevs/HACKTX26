ALTER TABLE `agents` ADD `rank` text DEFAULT 'grunt' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD `can_spawn_subagents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `agents` SET `rank` = 'orchestrator', `can_spawn_subagents` = 1 WHERE `role` = 'orchestrator';
--> statement-breakpoint
UPDATE `agents` SET `rank` = 'intermediate', `can_spawn_subagents` = 1 WHERE `id` = 'agt_red_team';
--> statement-breakpoint
UPDATE `agents` SET `rank` = 'grunt', `can_spawn_subagents` = 0, `propose_templates` = 0 WHERE `role` = 'worker' OR (`role` = 'security' AND `id` != 'agt_red_team');
