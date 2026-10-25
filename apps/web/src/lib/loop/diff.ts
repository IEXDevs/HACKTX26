/** Line diff and proposal hashing for the feedback loop. Pure. */
import { createHash } from "node:crypto";

/**
 * Unified-style line diff: unchanged lines start with two spaces, removed
 * lines with "- ", added lines with "+ ". Uses a longest-common-subsequence
 * table, which is fine for prompt-sized text.
 */
export function lineDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const rows = a.length + 1;
  const cols = b.length + 1;
  const lcs: number[] = new Array(rows * cols).fill(0);
  const at = (i: number, j: number) => lcs[i * cols + j]!;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * cols + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push(`- ${a[i]}`);
      i++;
    } else {
      out.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < a.length) out.push(`- ${a[i++]}`);
  while (j < b.length) out.push(`+ ${b[j++]}`);
  return out.join("\n");
}

/** Stable JSON: object keys sorted, so equal values hash equally. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([x], [y]) =>
      x.localeCompare(y),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** An approval names this hash, so it covers exactly one change to one version. */
export function proposalHash(input: {
  caseId: string;
  targetAgentId: string;
  round: number;
  baseVersion: number;
  change: unknown;
}): string {
  return createHash("sha256").update(stable(input)).digest("hex").slice(0, 32);
}
