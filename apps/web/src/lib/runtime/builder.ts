/**
 * Live agent builder. Muse holds a short conversation, then proposes an agent
 * team as JSON. The draft is validated here; nothing is created until the
 * person publishes it through POST /api/agents/custom.
 *
 * Mid-turn, the model may answer {"search": "query"} instead of a reply. The
 * server runs the search, hands back the results, and asks again.
 */
import { MODEL_BY_ID, TOOL_MANIFEST } from "@agent-os/core";
import { POPULAR_TOOLKITS, SERPAPI_TOOLKIT_INFO } from "../composio";
import { serpApiEnabled } from "../env";
import { recordModelTurn } from "../observability";
import { serpSearch, type WebSearchHit } from "../serpapi";
import { createLiveGateway, liveGatewayAvailable } from "./gateway";
import { parseBuilderReply, parseSearchRequest } from "./builder-parse";
import type { ModelGateway, ModelMessage } from "./types";
import { workflowBuilderGuidance, type WorkflowMode } from "../workflow-mode";
import { DRAFT_EXECUTION_REQUIREMENTS } from "./execution-guidance";

export { DraftSchema, parseBuilderReply, parseSearchRequest, type BuilderDraft } from "./builder-parse";
export type { WebSearchHit } from "../serpapi";

export interface BuilderTurn {
  role: "user" | "assistant";
  content: string;
}

export interface BuilderSearch {
  query: string;
  hits: WebSearchHit[];
}

/** Searches the model may run per incoming user message. */
export const MAX_BUILDER_SEARCHES = 2;

const KNOWN_APPS = [SERPAPI_TOOLKIT_INFO, ...POPULAR_TOOLKITS];

/**
 * Reusable parts of the builder instructions. The text builder joins them into
 * BUILDER_SYSTEM; the voice assistant reuses them in its own prompt.
 */
export const BUILDER_RULES = {
  /** Platform tools, one per line, with risk. Agents may only use these, by exact name. */
  tools: TOOL_MANIFEST.map((t) => `- ${t.name}: ${t.description} (${t.risk} risk)`).join("\n"),
  /** Known Composio apps by slug. Web search (serpapi) is built in. */
  apps: KNOWN_APPS.map((app) => `- ${app.slug}: ${app.name}`).join("\n"),
  /** Prefer what already exists, and never invent one. */
  realTools: [
    "- Prefer free tools, MCP servers, and Composio apps that already exist and work over building new ones.",
    "- Apps on the known list exist. Search to confirm any other tool, app, or MCP server exists and is current before naming it.",
    "- Never name a tool, app, or MCP server that a search did not confirm.",
  ].join("\n"),
  /** Phone work happens on voice lines, so the builder never rules it out. */
  voiceLine:
    "- Any published agent can take phone calls on its voice line, which listens and speaks for it. For a job that answers calls, write the instructions for the call itself: greet, collect the details, act, and confirm back. Never say phone calls are unsupported.",
  /** The draft JSON the builder proposes. */
  draftShape: `{"name": "...", "summary": "one sentence", "instructions": "the orchestrator's standing instructions", "goal": "the first concrete task to run, one or two sentences", "complexity": "trivial|standard|complex|critical", "apps": ["googlecalendar"], "workers": [{"name": "...", "role": "worker|security", "instructions": "...", "complexity": "...", "tools": ["kb.search"]}]}`,
} as const;

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
${BUILDER_RULES.tools}
- Prefer low-risk tools. High-risk tools pause the run for human approval.
- List the apps the agent needs in "apps" by slug, at most six. The person links them before the first run. Known apps:
${BUILDER_RULES.apps}
${BUILDER_RULES.realTools}
${BUILDER_RULES.voiceLine}
- After proposing, apply any change the person asks for and return the full updated draft.
- ${DRAFT_EXECUTION_REQUIREMENTS}

To search the web, answer with only {"search": "query"}. You get the results, then answer as usual. At most ${MAX_BUILDER_SEARCHES} searches per message.

Always answer with one JSON object and nothing else:
{"reply": "what you say to the person", "draft": null}
or, once you can propose:
{"reply": "...", "draft": ${BUILDER_RULES.draftShape}}`;

export const BUILDER_MODEL = process.env.BUILDER_MODEL ?? "muse-spark-1.3";

const SEARCH_UNAVAILABLE = "Web search is unavailable right now. Answer from what you know, and do not name tools, apps, or MCP servers you cannot confirm.";
const SEARCH_EXHAUSTED = "Searching is no longer available for this message. Answer now with {\"reply\", \"draft\"}.";
const FALLBACK_REPLY = "Tell me a little more about the job.";

/** Runs a builder search through SerpAPI. Throws when it is not configured. */
export async function builderSearch(query: string): Promise<WebSearchHit[]> {
  if (!serpApiEnabled()) throw new Error("Web search is not configured.");
  return serpSearch({ query, num: 5 });
}

function searchResults(query: string, hits: WebSearchHit[], left: number): string {
  const lines = hits.length
    ? hits.map((hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`)
    : ["No results."];
  return `Search results for "${query}":\n${lines.join("\n")}\n\nSearches left for this message: ${left}.`;
}

export interface BuilderApp {
  slug: string;
  name: string;
  /** The person has this app linked (see connectedToolkitsFor). */
  linked: boolean;
}

/** Display names and link status for a draft's apps. */
export function describeApps(slugs: readonly string[], connected: readonly string[]): BuilderApp[] {
  const linked = new Set(connected);
  return slugs.map((slug) => ({
    slug,
    name: KNOWN_APPS.find((app) => app.slug === slug)?.name ?? slug,
    linked: linked.has(slug),
  }));
}

export async function askBuilder(
  history: BuilderTurn[],
  opts?: {
    workspaceId?: string;
    workflowMode?: Exclude<WorkflowMode, "manual">;
    draft?: string;
    /** Injected in tests. Defaults to the live gateway. */
    gateway?: ModelGateway;
    /** Injected in tests. Defaults to SerpAPI. */
    search?: (query: string) => Promise<WebSearchHit[]>;
  },
) {
  if (!opts?.gateway && !liveGatewayAvailable()) {
    throw new Error("No live model is configured. Set MODEL_GATEWAY and a provider key.");
  }
  const gateway = opts?.gateway ?? createLiveGateway();
  const search = opts?.search ?? builderSearch;
  const needsDiscovery = !opts?.draft && history.filter((turn) => turn.role === "user").length < 2;
  const baseSystem = opts?.workflowMode
    ? `${BUILDER_SYSTEM}

${workflowBuilderGuidance(opts.workflowMode)}`
    : BUILDER_SYSTEM;
  const system = needsDiscovery
    ? `${baseSystem}

This is the initial discovery reply. Return draft: null and ask about the most important missing details. Do not offer Publish yet.`
    : baseSystem;
  const messages: ModelMessage[] = [
    { role: "system", content: system },
    ...history.slice(0, -1),
    ...(opts?.draft ? [{ role: "user" as const, content: `Current draft visible in the graph: ${opts.draft}` }] : []),
    ...history.slice(-1),
  ];
  const searches: BuilderSearch[] = [];
  let attempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  // Each search adds one round; one more round answers after the limit is refused.
  for (let round = 0; ; round++) {
    const text = await complete(gateway, messages, opts?.workspaceId, (input, output) => {
      inputTokens += input;
      outputTokens += output;
    });
    const query = parseSearchRequest(text);
    if (!query || round > MAX_BUILDER_SEARCHES) {
      const parsed = parseBuilderReply(text);
      // A search request on the last round has no reply to show.
      let reply = query ? FALLBACK_REPLY : parsed.reply;
      let draft = parsed.draft;
      // A premature model draft must not expose Publish before the person can add details.
      if (needsDiscovery && draft) {
        draft = null;
        reply = "Before I draft it, which sources or apps should it use, and what should the finished result look like? Include any important limits on what it can do.";
      }
      return { reply, draft, searches, model: BUILDER_MODEL, inputTokens, outputTokens };
    }
    messages.push({ role: "assistant", content: text });
    if (attempts >= MAX_BUILDER_SEARCHES) {
      messages.push({ role: "user", content: SEARCH_EXHAUSTED });
      continue;
    }
    attempts++;
    try {
      const hits = await search(query);
      searches.push({ query, hits });
      messages.push({ role: "user", content: searchResults(query, hits, MAX_BUILDER_SEARCHES - attempts) });
    } catch {
      messages.push({ role: "user", content: SEARCH_UNAVAILABLE });
    }
  }
}

async function complete(
  gateway: ModelGateway,
  messages: ModelMessage[],
  workspaceId: string | undefined,
  addUsage: (input: number, output: number) => void,
): Promise<string> {
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
  addUsage(inputTokens, outputTokens);
  if (workspaceId) {
    await recordModelTurn({
      workspaceId,
      source: "builder",
      agentName: "Builder",
      model: BUILDER_MODEL,
      messages: [...messages],
      completion: text,
      inputTokens,
      outputTokens,
    });
  }
  return text;
}
