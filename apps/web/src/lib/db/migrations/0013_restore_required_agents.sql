-- Restore required leads that were archived before archive protection existed.
UPDATE agents SET status = 'active', updated_at = unixepoch() * 1000
WHERE id IN ('agt_red_team', 'agt_blue_team') AND status = 'archived';
