/**
 * Live agent builder. Muse holds a short conversation, then proposes an agent
 * team as JSON. The draft is validated here; nothing is created until the
 * person publishes it through POST /api/agents/custom.
 */
import { MODEL_BY_ID, TOOL_MANIFEST } from "@agent-os/core";
import { recordModelTurn } from "../observability";
import { createLiveGateway, liveGatewayAvailable } from "./gateway";
import { parseBuilderReply } from "./builder-parse";
import { workflowBuilderGuidance, type WorkflowMode } from "../workflow-mode";
import { DRAFT_EXECUTION_REQUIREMENTS } from "./execution-guidance";

export { DraftSchema, parseBuilderReply, type BuilderDraft } from "./builder-parse";

export interface BuilderTurn {
  role: "user" | "assistant";
  content: string;
}

const tools = TOOL_MANIFEST.map((t) => `- ${t.name}: ${t.description} (${t.risk} risk)`).join("\n");

export const BUILDER_SYSTEM = `You design AI agents for an internal agent platform.
Talk with the person to understand the job, then propose an agent.

Rules:
- Keep the JSON reply field to one to three short, plain sentences. No lists or Markdown in that field. The agent's own final reports use Markdown.
- Before the first draft, understand the desired outcome and what counts as done, the inputs or connected apps and their scope, the output format and destination, and important limits or actions that need approval.
- Start with a short discovery exchange. Ask one or two focused questions about the most important missing details per reply. Usually two or three exchanges are enough. Use details already given; do not repeat answered questions or turn this into a long questionnaire.
- Do not propose a draft on the first reply. If the initial brief covers the important details, briefly confirm the intended scope and assumptions and ask whether anything should change. Wait for the person's answer before presenting a draft with Publish.
- On later replies, ask about any remaining detail that materially changes the agent's work. When the job is clear enough, state reasonable assumptions and return the draft. If the person asks you to choose defaults, do so instead of continuing to question them.
- When you propose, design one orchestrator and zero to four workers. Give each worker one clear job.
- Only use tools from this list, by exact name:
${tools}
- Prefer low-risk tools. High-risk tools pause the run for human approval.
- After proposing, apply any change the person asks for and return the full updated draft.
- ${DRAFT_EXECUTION_REQUIREMENTS}

Always answer with one JSON object and nothing else:
{"reply": "what you say to the person", "draft": null}
or, once you can propose:
{"reply": "...", "draft": {"name": "...", "summary": "one sentence", "instructions": "the orchestrator's standing instructions", "goal": "the first concrete task to run, one or two sentences", "complexity": "trivial|standard|complex|critical", "workers": [{"name": "...", "role": "worker|security", "instructions": "...", "complexity": "...", "tools": ["kb.search"]}]}}`;

export const BUILDER_MODEL = process.env.BUILDER_MODEL ?? "muse-spark-1.3";

export async function askBuilder(
  history: BuilderTurn[],
  opts?: { workspaceId?: string; workflowMode?: Exclude<WorkflowMode, "manual">; draft?: string },
) {
  if (!liveGatewayAvailable()) {
    throw new Error("No live model is configured. Set MODEL_GATEWAY and a provider key.");
  }
  const gateway = createLiveGateway();
  const needsDiscovery = !opts?.draft && history.filter((turn) => turn.role === "user").length < 2;
  const baseSystem = opts?.workflowMode
    ? `${BUILDER_SYSTEM}\n\n${workflowBuilderGuidance(opts.workflowMode)}`
    : BUILDER_SYSTEM;
  const system = needsDiscovery
    ? `${baseSystem}\n\nThis is the initial discovery reply. Return draft: null and ask about the most important missing details. Do not offer Publish yet.`
    : baseSystem;
  const messages = [
    { role: "system" as const, content: system },
    ...history.slice(0, -1),
    ...(opts?.draft ? [{ role: "user" as const, content: `Current draft visible in the graph: ${opts.draft}` }] : []),
    ...history.slice(-1),
  ];
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  for await (const chunk of gateway.complete({
    model: BUILDER_MODEL,
    messages,
    tools: [],
    temperature: 0.3,
    maxOutputTokens: 4000,
    // Muse returns empty completions without an explicit reasoning effort.
    reasoningEffort: MODEL_BY_ID.get(BUILDER_MODEL)?.provider === "meta" ? "medium" : undefined,
  })) {
    if (chunk.type === "text") text += chunk.text;
    if (chunk.type === "usage") {
      inputTokens = chunk.inputTokens;
      outputTokens = chunk.outputTokens;
    }
  }
  if (opts?.workspaceId) {
    await recordModelTurn({
      workspaceId: opts.workspaceId,
      source: "builder",
      agentName: "Builder",
      model: BUILDER_MODEL,
      messages,
      completion: text,
      inputTokens,
      outputTokens,
    });
  }
  const result = parseBuilderReply(text);
  // A premature model draft must not expose Publish before the person can add details.
  if (needsDiscovery && result.draft) {
    result.draft = null;
    result.reply = "Before I draft it, which sources or apps should it use, and what should the finished result look like? Include any important limits on what it can do.";
  }
  return { ...result, model: BUILDER_MODEL, inputTokens, outputTokens };
}
