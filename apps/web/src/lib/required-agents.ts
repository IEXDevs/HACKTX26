/** Platform agents use reserved identities, so a renamed lead stays protected. */
export function requiredAgentName(id: string): string | null {
  if (id === "agt_red_team" || id.startsWith("agt_red_team_ws_account_")) return "Red Team";
  if (id === "agt_blue_team" || id.startsWith("agt_blue_team_ws_account_")) return "Blue Team";
  if (id === "builtin-motivator" || id.startsWith("mot_")) return "Motivator";
  return null;
}

export function canArchiveAgent(id: string): boolean {
  return requiredAgentName(id) === null;
}
