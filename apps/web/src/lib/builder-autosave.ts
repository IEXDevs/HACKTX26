import { z } from "zod";
import { DraftSchema } from "./runtime/builder-parse";

export const BuilderAutosaveSchema = z.object({
  version: z.literal(1),
  input: z.string(),
  messages: z.array(z.object({ id: z.string(), from: z.enum(["you", "builder"]), text: z.string(), draft: DraftSchema.optional(),
    apps: z.array(z.object({ slug: z.string(), name: z.string(), linked: z.boolean() })).optional(), searches: z.array(z.string()).optional() })),
  draft: DraftSchema.nullable(),
  canSpawnSubagents: z.boolean(), proposeTemplates: z.boolean(),
  attachments: z.array(z.discriminatedUnion("kind", [z.object({ kind: z.literal("github"), repo: z.string(), branch: z.string() }), z.object({ kind: z.literal("app"), slug: z.string(), name: z.string() })])),
});

export function builderStorageKey(accountScope: string, mode = "agent") {
  return `astronom.builder.v1.${accountScope}.${mode}`;
}

export function readBuilderAutosave(value: string | null) {
  try { return BuilderAutosaveSchema.parse(JSON.parse(value ?? "null")); } catch { return null; }
}
