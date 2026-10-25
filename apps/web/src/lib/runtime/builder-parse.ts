/** Builder draft schema and reply parsing. Pure; no app imports, so it is easy to test. */
import { z } from "zod";
import { workerDepths } from "../agent-tree";

export const MAX_WORKFLOW_WORKERS = 24;

const Complexity = z.enum(["trivial", "standard", "complex", "critical"]);

export const DraftSchema = z.object({
  name: z.string().trim().min(2).max(64),
  summary: z.string().trim().min(1).max(240),
  instructions: z.string().trim().min(20).max(3000),
  // A bad goal only loses the prefill; it must not sink the whole draft.
  goal: z.string().trim().min(8).max(2000).optional().catch(undefined),
  complexity: Complexity.catch("standard"),
  workers: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(64),
        role: z.enum(["worker", "security"]).catch("worker"),
        instructions: z.string().trim().min(10).max(1500),
        complexity: Complexity.catch("standard"),
        tools: z.array(z.string()).max(6).catch([]),
        parentIndex: z.number().int().min(-1).max(MAX_WORKFLOW_WORKERS - 1).optional(),
      }),
    )
    .max(MAX_WORKFLOW_WORKERS)
    .catch([]),
}).superRefine((draft, context) => {
  try {
    workerDepths(draft.workers);
  } catch (error) {
    context.addIssue({ code: "custom", path: ["workers"], message: (error as Error).message });
  }
});
export type BuilderDraft = z.infer<typeof DraftSchema>;

/** Pulls the first JSON object out of a model reply and validates its draft. */
export function parseBuilderReply(text: string): { reply: string; draft: BuilderDraft | null } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(text.slice(start, end + 1)) as { reply?: unknown; draft?: unknown };
      const reply = typeof value.reply === "string" && value.reply.trim() ? value.reply.trim() : "";
      const draft = value.draft ? DraftSchema.safeParse(value.draft) : null;
      return {
        reply: reply || (draft?.success ? "Here is the agent. Publish it, or tell me what to change." : ""),
        draft: draft?.success ? draft.data : null,
      };
    } catch {
      // Fall through to plain text.
    }
  }
  return { reply: text.trim(), draft: null };
}
