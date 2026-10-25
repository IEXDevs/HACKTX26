/**
 * The agents that belong with `id`: its top-level agent and everything below it.
 *
 * Publishing checks the team an agent is part of, not the whole workspace. One
 * team's problem, or a standalone agent like a team lead, must not stop an
 * unrelated agent from being published.
 */
export function treeContaining<T extends { id: string; parentAgentId: string | null }>(
  rows: readonly T[],
  id: string,
): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const start = byId.get(id);
  if (!start) return [];

  // Climb to the top. A missing parent stops the climb; the validator reports it.
  const climbed = new Set<string>();
  let top = start;
  while (top.parentAgentId && byId.has(top.parentAgentId) && !climbed.has(top.id)) {
    climbed.add(top.id);
    top = byId.get(top.parentAgentId)!;
  }

  // Collect everything below it.
  const members = new Set<string>([top.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of rows) {
      if (!members.has(row.id) && row.parentAgentId && members.has(row.parentAgentId)) {
        members.add(row.id);
        grew = true;
      }
    }
  }
  return rows.filter((row) => members.has(row.id));
}
