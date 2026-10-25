import { z } from "zod";

/** The visible chat only. Model prompts and serialized draft revisions stay separate. */
export const BuilderConversationSchema = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(6000),
})).max(40);
export type BuilderConversation = z.infer<typeof BuilderConversationSchema>;
