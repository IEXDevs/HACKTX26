/**
 * Live agent builder. Muse holds a short conversation, then proposes an agent
 * team as JSON. The draft is validated here; nothing is created until the
 * person publishes it through POST /api/agents/custom.
 */
import { MODEL_BY_ID, TOOL_MANIFEST } from "@agent-os/core";
import { recordModelTurn } from "../observability";
import { createLiveGateway, liveGatewayAvailable } from "./gateway";
import { parseBuilderReply } from "./builder-parse";

export { DraftSchema, parseBuilderReply, type BuilderDraft } from "./builder-parse";

export interface BuilderTurn {
  role: "user" | "assistant";
  content: string;
}

const tools = TOOL_MANIFEST.map((t) => `- ${t.name}: ${t.description} (${t.risk} risk)`).join("\n");

export const BUILDER_SYSTEM = `You design AI agents for an internal agent platform.
Talk with the person to understand the job, then propose an agent.

Rules:
- Keep each reply to one to three short, plain sentences. No lists, no markdown.
- Ask at most two clarifying questions in total, one at a time. If the request is already clear, propose right away.
- When you propose, design one orchestrator and zero to four workers. Give each worker one clear job.
- Only use tools from this list, by exact name:
${tools}
- Prefer low-risk tools. High-risk tools pause the run for human approval.
- After proposing, apply any change the person asks for and return the full updated draft.

Always answer with one JSON object and nothing else:
{"reply": "what you say to the person", "draft": null}
or, once you can propose:
{"reply": "...", "draft": {"name": "...", "summary": "one sentence", "instructions": "the orchestrator's standing instructions", "goal": "the first concrete task to run, one or two sentences", "complexity": "trivial|standard|complex|critical", "workers": [{"name": "...", "role": "worker|security", "instructions": "...", "complexity": "...", "tools": ["kb.search"]}]}}`;

export const BUILDER_MODEL = process.env.BUILDER_MODEL ?? "muse-spark-1.3";

export async function askBuilder(
  history: BuilderTurn[],
  opts?: { workspaceId?: string },
) {
  if (!liveGatewayAvailable()) {
    throw new Error("No live model is configured. Set MODEL_GATEWAY and a provider key.");
  }
  const gateway = createLiveGateway();
  const messages = [{ role: "system" as const, content: BUILDER_SYSTEM }, ...history];
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
  return { ...parseBuilderReply(text), model: BUILDER_MODEL, inputTokens, outputTokens };
}
