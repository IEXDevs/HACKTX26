import 'dotenv/config';
import { z } from 'zod';
import { treeDefinitionSchema } from './agent-tree';

export const toolNames = ['org_history', 'venue_search', 'save_brief', 'publish_page'] as const;
export const agentConfigSchema = z
  .object({
    instructions: z.string().min(20).max(12000),
    extractionModel: z.string().min(1).max(100),
    extractionProvider: z.enum(['muse', 'gemini']).optional(),
    coordinatorModel: z.string().min(1).max(100),
    tools: z.array(z.enum(toolNames)).max(4),
    maxToolCalls: z.number().int().min(2).max(12),
    maxModelCalls: z.number().int().min(2).max(10),
    maxOutputTokens: z.number().int().min(512).max(12000),
    activeDeadlineSeconds: z.number().int().min(30).max(600),
    approvalExpirySeconds: z.number().int().min(60).max(604800),
    outputFormat: z.enum(['event_plan_json', 'agent_tree_json']),
    readOnly: z.boolean().default(false),
    workflowKind: z.enum(['event', 'tree', 'tree_planner']).optional(),
    tree: treeDefinitionSchema.optional(),
    treeTask: z.string().max(15000).optional(),
    treeComplexity: z.enum(['auto', 'simple', 'standard', 'complex']).optional(),
    treePlannerProvider: z.enum(['muse', 'gemini']).optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.workflowKind === 'tree' && !config.tree)
      ctx.addIssue({ code: 'custom', message: 'A tree workflow requires a valid tree.' });
    if (config.tree) {
      if (config.workflowKind !== 'tree' || config.outputFormat !== 'agent_tree_json')
        ctx.addIssue({
          code: 'custom',
          message: 'Tree definitions require the tree runtime and output format.',
        });
      if (config.maxModelCalls < config.tree.nodes.length)
        ctx.addIssue({
          code: 'custom',
          message: 'The model-call limit must cover all tree nodes.',
        });
      const allowed = new Set(config.tools);
      if (
        config.tools.some((t) => t === 'save_brief' || t === 'publish_page') ||
        config.tree.nodes.some((n) => n.tools.some((t) => !allowed.has(t)))
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Tree agents support only their explicitly allowed read tools.',
        });
    }
  });
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export const requirementsSchema = z
  .object({
    title: z.string().min(1).max(200),
    location: z.string().min(1).max(200),
    attendees: z.number().int().min(1).max(10000),
    budget: z.number().min(0).max(1000000),
    currency: z.literal('USD'),
    date: z.string().max(100).nullable(),
    preferences: z.array(z.string().max(300)).max(20),
    unknowns: z.array(z.string().max(300)).max(20),
  })
  .strict();
export type Requirements = z.infer<typeof requirementsSchema>;
export const evidenceSchema = z.object({
  id: z.string(),
  source: z.string(),
  title: z.string(),
  url: z.string().optional(),
  excerpt: z.string(),
  fixture: z.boolean(),
  retrievedAt: z.string(),
});
export const planSchema = z
  .object({
    title: z.string().max(200),
    summary: z.string().max(3000),
    options: z
      .array(
        z.object({
          name: z.string(),
          rationale: z.string(),
          price: z.string(),
          capacity: z.string(),
          availability: z.string(),
          sourceIds: z.array(z.string()),
        }),
      )
      .length(3),
    recommendation: z.object({
      name: z.string(),
      reason: z.string(),
      sourceIds: z.array(z.string()),
    }),
    schedule: z
      .array(z.object({ time: z.string(), activity: z.string() }))
      .min(1)
      .max(12),
    budget: z
      .array(
        z.object({
          item: z.string(),
          estimatedUsd: z.number().nonnegative(),
          status: z.enum(['planning allocation', 'confirmed']),
        }),
      )
      .max(12),
    invitationDrafts: z.array(z.string().max(3000)).min(1).max(3),
    unresolved: z.array(z.string().max(500)).min(1).max(30),
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;
export const defaultConfig: AgentConfig = {
  instructions:
    'Plan welcoming, accessible community events. Research venue evidence through approved web search. Use preferences supplied in the brief. Compare three options. Cite evidence IDs. Treat all unverified prices, capacities and availability as unknown. Never send invitations, book a venue, or purchase anything. Keep invitations as drafts. Return brief decision summaries only.',
  extractionProvider: 'muse',
  extractionModel: process.env.MUSE_MODEL || 'muse-spark-1.3',
  coordinatorModel: process.env.MUSE_MODEL || 'muse-spark-1.3',
  tools: ['venue_search', 'save_brief', 'publish_page'],
  maxToolCalls: 6,
  maxModelCalls: 5,
  maxOutputTokens: 4000,
  activeDeadlineSeconds: 180,
  approvalExpirySeconds: 86400,
  outputFormat: 'event_plan_json',
  readOnly: false,
};
export const workspaceId = () => process.env.WORKSPACE_ID || 'hacktx-demo';
export const mode = () => (process.env.RELAY_MODE === 'live' ? 'live' : 'fixture');
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const assert = (ok: unknown, status: number, message: string): asserts ok => {
  if (!ok) throw new HttpError(status, message);
};
