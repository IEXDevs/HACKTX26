/**
 * Tools the blue team uses to work a case. They are not in the public tool
 * manifest, so the agent builder cannot offer them: only blue-team agents
 * hold them, from the roster in runtime/scripts.ts. Each one acts on the case
 * record through blue-team.ts. None of them writes to an agent.
 */
import type { ToolManifestEntry } from "@agent-os/core";
import type { AgentRow, CaseChange } from "@/lib/db/schema";
import { redactSecrets } from "@/lib/secrets";

export const CASE_TOOLS: readonly ToolManifestEntry[] = [
  {
    name: "case.read",
    label: "Read case",
    description: "Read a case: what the red team saw, the steps to repeat it, the current proposal, and the latest retest.",
    category: "meta",
    scopes: ["read"],
    risk: "low",
    sandboxedToAgentFs: false,
    argsHint: "{ case: string }",
  },
  {
    name: "case.triage",
    label: "Triage case",
    description:
      "Triage a new case. The platform checks that its reproduction is exact, merges it into an earlier case if it is a duplicate, and queues it behind any active case for the same agent.",
    category: "meta",
    scopes: ["write"],
    risk: "medium",
    sandboxedToAgentFs: false,
    argsHint: "{ case: string, note?: string }",
  },
  {
    name: "case.draft_fix",
    label: "Draft fix",
    description:
      "Draft one change to the case's agent as a diff for a person to approve. Prefer new instructions, then removing tools, then a locked rule for that agent only. Writes nothing to the agent.",
    category: "meta",
    scopes: ["write"],
    risk: "medium",
    sandboxedToAgentFs: false,
    argsHint: "{ case: string, instructions?: string, removeTools?: string[], rule?: string, reply?: string }",
  },
  {
    name: "case.verify",
    label: "Verify retest",
    description: "Take the case's retest as its Verifier, and report the retest's run ids and verdict so far.",
    category: "meta",
    scopes: ["read"],
    risk: "low",
    sandboxedToAgentFs: false,
    argsHint: "{ case: string }",
  },
  {
    name: "case.start_retest",
    label: "Start retest",
    description: "Platform action for the Blue Team Lead: start the retest of an applied fix once a Verifier has it.",
    category: "meta",
    scopes: ["execute"],
    risk: "medium",
    sandboxedToAgentFs: false,
    argsHint: "{ case: string }",
  },
];

export const CASE_TOOL_BY_NAME: ReadonlyMap<string, ToolManifestEntry> = new Map(CASE_TOOLS.map((t) => [t.name, t]));

/** Only blue-team agents that hold the tool. No agent can grant one. */
export function mayUseCaseTool(agent: Pick<AgentRow, "team" | "allowedTools">, name: string): boolean {
  return CASE_TOOL_BY_NAME.has(name) && agent.team === "blue" && agent.allowedTools.includes(name);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A model-written change, if the call carries one. */
function changeFrom(args: Record<string, unknown>): CaseChange | undefined {
  const instructions = text(args.instructions);
  if (instructions) return { kind: "instructions", instructions };
  if (Array.isArray(args.removeTools)) {
    const removeTools = args.removeTools.filter((t): t is string => typeof t === "string");
    if (removeTools.length) return { kind: "narrow_tools", removeTools };
  }
  const rule = text(args.rule);
  return rule ? { kind: "scoped_rule", rule } : undefined;
}

export async function executeCaseTool(
  agent: AgentRow,
  name: string,
  args: Record<string, unknown>,
  caseFromGoal: string | null,
): Promise<{ ok: boolean; preview: string; error?: string }> {
  const caseId = text(args.case) ?? caseFromGoal;
  if (!caseId) return { ok: false, preview: "", error: `${name} needs the case id.` };
  // Imported lazily to keep the loop module out of the engine's import graph.
  const blue = await import("./blue-team");
  try {
    if (name === "case.read") return { ok: true, preview: await blue.describeCase(caseId) };
    if (name === "case.triage") {
      const row = await blue.recordTriage(caseId, agent.id, text(args.note) ?? "");
      const outcome = !row.triage?.reproduces
        ? "The reproduction is not exact, so the case went to a person."
        : row.triage.duplicateOf
          ? `This is a duplicate. It was merged into ${row.triage.duplicateOf}.`
          : row.state === "queued"
            ? "Confirmed. The case is queued behind the agent's active case."
            : "Confirmed. The case is active and ready for a Fix Drafter.";
      return { ok: true, preview: `Triage recorded for ${row.id}. ${outcome}` };
    }
    if (name === "case.draft_fix") {
      const row = await blue.draftFix(caseId, agent.id, { change: changeFrom(args), reply: text(args.reply) });
      return {
        ok: true,
        preview: `Drafted: ${row.proposal?.summary} It waits for a person's approval in the creator conversation.\n${row.proposal?.diff ?? ""}`.slice(0, 1800),
      };
    }
    if (name === "case.verify") {
      return { ok: true, preview: await blue.verifierReport(caseId, agent.id) };
    }
    if (name === "case.start_retest") {
      const row = await blue.leadStartRetest(caseId, agent.id);
      if (row.state === "escalated") return { ok: false, preview: "", error: row.escalationReason ?? "The case went to a person." };
      const retest = row.retests[row.retests.length - 1];
      return {
        ok: true,
        preview: `Retest started for round ${row.round}: ${retest?.runs.length ?? 0} run started, ${retest?.queued.length ?? 0} queued.`,
      };
    }
    return { ok: false, preview: "", error: `Unknown case tool "${name}".` };
  } catch (error) {
    return { ok: false, preview: "", error: redactSecrets((error as Error).message) };
  }
}
