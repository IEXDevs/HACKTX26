/**
 * Case-review mode for the agent creator. Muse reads a feedback-loop case and
 * proposes one targeted change to the agent under test. The proposal is only
 * a proposal: lib/loop/cases.ts applies it after a person approves it.
 */
import { MODEL_BY_ID, TOOL_BY_NAME } from "@agent-os/core";
import { z } from "zod";
import type { AgentRow, CaseChange, FindingCaseRow, SecurityFindingRow } from "@/lib/db/schema";
import { BUILDER_MODEL } from "./builder";
import { createLiveGateway, liveGatewayAvailable } from "./gateway";
import { ruleFor, suggestedChange } from "./autoheal";

const ChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("instructions"), instructions: z.string().trim().min(20).max(8000) }),
  z.object({ kind: z.literal("narrow_tools"), removeTools: z.array(z.string()).min(1).max(12) }),
  z.object({ kind: z.literal("scoped_rule"), rule: z.string().trim().min(20).max(2000) }),
]);

export function caseReviewSystem(target: AgentRow, row: FindingCaseRow, finding: SecurityFindingRow): string {
  const tools = target.allowedTools
    .map((name) => `- ${name} (${TOOL_BY_NAME.get(name)?.risk ?? "unknown"} risk)`)
    .join("\n");
  const lastRetest = row.retests[row.retests.length - 1];
  const evidence =
    lastRetest && lastRetest.verdict === "failed"
      ? `\nThe last fix failed its retest:\n${lastRetest.failures.map((f) => `- ${f.reason}`).join("\n")}`
      : "";
  return `You built the agent "${target.name}". The red team found a problem in it, and the case has come back to you.

The agent's current instructions:
"""
${target.instructions}
"""
Its tools:
${tools || "- none"}

The case:
- Severity: ${row.severity}
- What happened: ${row.observed}
- Red team suggestion: ${row.proposedRemediation || "none"}
- Suggested rule for this kind of problem: ${ruleFor(finding.category)}${evidence}

Propose the smallest change that stops this problem in this agent only. Prefer, in order:
1. A change to the agent's own instructions (return the full new instructions).
2. Removing tools it does not need.
3. A locked rule for this agent only.
Never add tools or permissions. Never change other agents.

Keep your reply to one to three plain sentences. Always answer with one JSON object and nothing else:
{"reply": "...", "proposal": null}
or
{"reply": "...", "proposal": {"kind": "instructions", "instructions": "full new text"}}
{"reply": "...", "proposal": {"kind": "narrow_tools", "removeTools": ["tool.name"]}}
{"reply": "...", "proposal": {"kind": "scoped_rule", "rule": "rule text"}}`;
}

const NO_ANSWER = "The creator did not answer.";

export interface CaseReviewReply {
  reply: string;
  change: CaseChange | null;
  source: "live" | "suggested";
}

/**
 * Ask the creator for a reply and, when it can, a proposal. Without a live
 * model the built-in suggestion is offered and labeled as such.
 */
export async function askCaseReview(
  target: AgentRow,
  row: FindingCaseRow,
  finding: SecurityFindingRow,
): Promise<CaseReviewReply> {
  if (!await liveGatewayAvailable()) {
    return {
      reply: "No live model is set up, so here is the built-in suggestion for this kind of problem.",
      change: suggestedChange(target, finding),
      source: "suggested",
    };
  }
  const history = row.conversation
    .filter((m) => !(m.from === "creator" && m.text === NO_ANSWER))
    .map((m) => ({
      role: m.from === "creator" ? ("assistant" as const) : ("user" as const),
      content: m.text,
    }));
  // Always end on a request, or the model may treat the last creator turn as its answer.
  const messages = [
    { role: "system" as const, content: caseReviewSystem(target, row, finding) },
    ...history,
    { role: "user" as const, content: "Reply now with your JSON object." },
  ];
  let text = "";
  for (let attempt = 1; attempt <= 2 && !text.trim(); attempt++) {
    for await (const chunk of (await createLiveGateway()).complete({
      model: BUILDER_MODEL,
      messages,
      tools: [],
      temperature: 0.2,
      maxOutputTokens: 4000,
      reasoningEffort: MODEL_BY_ID.get(BUILDER_MODEL)?.provider === "meta" ? "medium" : undefined,
    })) {
      if (chunk.type === "text") text += chunk.text;
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as { reply?: unknown; proposal?: unknown };
    const change = value.proposal ? ChangeSchema.safeParse(value.proposal) : null;
    return {
      reply: typeof value.reply === "string" && value.reply.trim() ? value.reply.trim() : "Here is a proposed change.",
      change: change?.success ? change.data : null,
      source: "live",
    };
  } catch {
    return { reply: text.trim() || NO_ANSWER, change: null, source: "live" };
  }
}
