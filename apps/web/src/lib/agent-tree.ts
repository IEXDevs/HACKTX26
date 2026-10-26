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

/** Descendants in depth-first order. Index parents once and stop at cycles. */
export function descendantsOf<T extends { id: string; parentAgentId: string | null }>(
  rows: readonly T[],
  rootId: string,
): T[] {
  const children = new Map<string, T[]>();
  for (const row of rows) {
    if (row.parentAgentId === null) continue;
    const siblings = children.get(row.parentAgentId);
    if (siblings) siblings.push(row);
    else children.set(row.parentAgentId, [row]);
  }

  const found: T[] = [];
  const visited = new Set([rootId]);
  const pending = [...(children.get(rootId) ?? [])].reverse();
  while (pending.length) {
    const row = pending.pop()!;
    if (visited.has(row.id)) continue;
    visited.add(row.id);
    found.push(row);
    const nested = children.get(row.id) ?? [];
    for (let index = nested.length - 1; index >= 0; index--) pending.push(nested[index]!);
  }
  return found;
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

  const members = new Set([top.id, ...descendantsOf(rows, top.id).map((row) => row.id)]);
  return rows.filter((row) => members.has(row.id));
}
