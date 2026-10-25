/** Workers use a zero-based parent index; -1 (or no index) means the lead. */
export function workerDepths(workers: readonly { parentIndex?: number }[]): number[] {
  const depths: number[] = [];
  for (const [index, worker] of workers.entries()) {
    const parent = worker.parentIndex ?? -1;
    if (!Number.isInteger(parent) || parent < -1 || parent >= index) {
      throw new Error("Each worker must report to the lead or an earlier worker.");
    }
    const depth = parent === -1 ? 1 : depths[parent]! + 1;
    if (depth > 3) throw new Error("The agent tree supports three levels below the lead.");
    depths.push(depth);
  }
  return depths;
}

/**
 * The agents that belong with `id`: its top-level agent and everything below it.
 * Publishing validates this team rather than unrelated teams in the workspace.
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
