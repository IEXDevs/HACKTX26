/**
 * Astro: the spoken agent builder. It runs on the Gemini Live API in the
 * browser; this file only defines its persona and functions, which the server
 * locks into the Live token. The browser handles each function call:
 * propose_agent (validate with DraftSchema and show it), search_web (POST
 * /api/builder/search), and build_agent (create the shown draft).
 */
import { TOOL_MANIFEST } from "@agent-os/core";
import type { LiveFunction, LiveSessionConfig } from "./gemini";
import { BUILDER_RULES } from "./runtime/builder";
import { MAX_DRAFT_APPS, MAX_WORKFLOW_WORKERS } from "./runtime/builder-parse";

export const ASTRO_VOICE = "Puck";

const complexity = {
  type: "string",
  enum: ["trivial", "standard", "complex", "critical"],
  description: "How hard the job is. Pick the lowest level that fits.",
};

export const ASTRO_FUNCTIONS: LiveFunction[] = [
  {
    name: "propose_agent",
    description:
      "Show the person a proposed agent team. Call again with the full updated draft to change it. Never read the arguments aloud.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short agent name, 2 to 64 characters." },
        summary: { type: "string", description: "One sentence on what the agent does." },
        instructions: {
          type: "string",
          description: "The lead agent's standing instructions, at least 20 characters.",
        },
        goal: { type: "string", description: "The first concrete task to run, one or two sentences." },
        complexity,
        apps: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_DRAFT_APPS,
          description: "Slugs of the apps the agent needs, such as googlecalendar. The person links them before the first run.",
        },
        workers: {
          type: "array",
          maxItems: MAX_WORKFLOW_WORKERS,
          description: "Zero to four helpers, each with one clear job.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Short helper name." },
              role: { type: "string", enum: ["worker", "security"] },
              instructions: { type: "string", description: "What this helper does, at least 10 characters." },
              complexity,
              tools: {
                type: "array",
                items: { type: "string", enum: TOOL_MANIFEST.map((tool) => tool.name) },
                maxItems: 6,
                description: "Platform tools by exact name.",
              },
              parentIndex: {
                type: "integer",
                minimum: -1,
                description: "Zero-based index of an earlier helper this one reports to. Omit or -1 for the lead.",
              },
            },
            required: ["name", "role", "instructions", "complexity", "tools"],
          },
        },
      },
      required: ["name", "summary", "instructions", "goal", "complexity", "apps", "workers"],
    },
  },
  {
    name: "search_web",
    description:
      "Search the web to confirm a tool, app, or MCP server exists and is current before naming it. Returns the top results.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "A short search query." } },
      required: ["query"],
    },
  },
  {
    name: "build_agent",
    description:
      "Create the agent that is currently shown. Only call this after the person clearly says to build or create it.",
    parameters: { type: "object", properties: {} },
  },
];

export const ASTRO_SYSTEM = `You are Astro, a voice assistant that designs AI agents for an internal agent platform. You are speaking out loud with a person.

How you talk:
- Speak in short, natural sentences. One idea at a time. Be warm and direct.
- Never read out JSON, code, field names, slugs, or tool names. Say what things do in plain words.
- Ask one question at a time, and at most three in total. If the job is already clear, skip ahead and propose.

How you work:
- First learn the job: what should happen, which apps and data are involved, and what a good result looks like.
- Then call propose_agent with a full draft and tell the person in a sentence or two what it does. Ask whether to build it or change something.
- To change the draft, call propose_agent again with the whole updated draft.
- Call build_agent only after the person clearly says to build or create it. If you are unsure, ask.
- Before searching, say a few words such as "Let me check that."
- If a function returns an error, fix the problem and try again, or tell the person briefly.

Designing the agent:
- One lead agent and zero to four helpers. Give each helper one clear job.
- Helpers may only use these platform tools, by exact name:
${BUILDER_RULES.tools}
- Prefer low-risk tools. High-risk tools pause the run for human approval.
- Put the apps the agent needs in "apps" by slug, at most ${MAX_DRAFT_APPS}. Known apps:
${BUILDER_RULES.apps}
${BUILDER_RULES.realTools}
${BUILDER_RULES.voiceLine}
- Use search_web to confirm anything that is not on the lists above.

The draft has this shape:
${BUILDER_RULES.draftShape}`;

/** Astro's Live session: persona, functions, and voice. */
export async function astroSessionConfig(): Promise<LiveSessionConfig> {
  return { systemInstruction: ASTRO_SYSTEM, functions: ASTRO_FUNCTIONS, voiceName: ASTRO_VOICE };
}
