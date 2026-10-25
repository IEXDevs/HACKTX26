/**
 * Model catalog + routing.
 *
 * The router is a pure function over (task requirements, catalog, policy) so
 * routing decisions are reproducible and unit-testable. Every decision is
 * emitted as a `router.decision` event, which means "why did this run on the
 * expensive model" is always answerable after the fact.
 */
import { z } from "zod";
import { DataClassSchema, ModelTierSchema } from "./events";

export const ModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  tier: ModelTierSchema,
  contextWindow: z.number().int().positive(),
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
  /** Cached-prefix input, USD per million tokens. Falls back to inputPerMTok. */
  cachedInputPerMTok: z.number().nonnegative().optional(),
  /** Data classifications this model is approved to receive. */
  allowedDataClasses: z.array(DataClassSchema),
  capabilities: z.array(
    z.enum(["tool_calling", "long_context", "vision", "code", "reasoning"]),
  ),
  /** Typical first-token latency, milliseconds. */
  latencyMs: z.number().int().nonnegative(),
  selfHosted: z.boolean().default(false),
  notes: z.string().optional(),
});

export type Model = z.infer<typeof ModelSchema>;
export type ModelTier = z.infer<typeof ModelTierSchema>;
export type DataClass = z.infer<typeof DataClassSchema>;
export type Capability = Model["capabilities"][number];

/**
 * Model catalogue. Meta rows use published Model API rates
 * (https://dev.meta.ai/docs/pricing-rate-limits, October 2026). Other
 * providers are list prices so the budget ledger has something concrete.
 */
export const MODEL_CATALOG: readonly Model[] = [
  {
    id: "anthropic/claude-opus-4-6",
    label: "Claude Opus 4.6",
    provider: "anthropic",
    tier: "frontier",
    contextWindow: 500_000,
    inputPerMTok: 15,
    outputPerMTok: 75,
    allowedDataClasses: ["public", "internal", "confidential"],
    capabilities: ["tool_calling", "long_context", "vision", "code", "reasoning"],
    latencyMs: 1400,
    selfHosted: false,
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    tier: "balanced",
    contextWindow: 400_000,
    inputPerMTok: 3,
    outputPerMTok: 15,
    allowedDataClasses: ["public", "internal", "confidential"],
    capabilities: ["tool_calling", "long_context", "vision", "code"],
    latencyMs: 700,
    selfHosted: false,
  },
  {
    id: "anthropic/claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    tier: "fast",
    contextWindow: 200_000,
    inputPerMTok: 0.8,
    outputPerMTok: 4,
    allowedDataClasses: ["public", "internal"],
    capabilities: ["tool_calling", "code"],
    latencyMs: 320,
    selfHosted: false,
  },
  {
    id: "openai/gpt-5.4",
    label: "GPT-5.4",
    provider: "openai",
    tier: "frontier",
    contextWindow: 400_000,
    inputPerMTok: 12,
    outputPerMTok: 60,
    allowedDataClasses: ["public", "internal", "confidential"],
    capabilities: ["tool_calling", "long_context", "vision", "code", "reasoning"],
    latencyMs: 1300,
    selfHosted: false,
  },
  {
    id: "openai/gpt-5.4-mini",
    label: "GPT-5.4 mini",
    provider: "openai",
    tier: "balanced",
    contextWindow: 256_000,
    inputPerMTok: 1.2,
    outputPerMTok: 6,
    allowedDataClasses: ["public", "internal"],
    capabilities: ["tool_calling", "code"],
    latencyMs: 520,
    selfHosted: false,
  },
  {
    id: "google/gemini-3-pro",
    label: "Gemini 3 Pro",
    provider: "google",
    tier: "frontier",
    contextWindow: 2_000_000,
    inputPerMTok: 2.5,
    outputPerMTok: 12,
    allowedDataClasses: ["public", "internal"],
    capabilities: ["tool_calling", "long_context", "vision", "code"],
    latencyMs: 900,
    selfHosted: false,
  },
  {
    id: "muse-wonder-1.0",
    label: "Muse Wonder 1.0",
    provider: "meta",
    tier: "frontier",
    contextWindow: 1_048_576,
    inputPerMTok: 4.0,
    outputPerMTok: 20.0,
    cachedInputPerMTok: 0.2,
    allowedDataClasses: ["public", "internal", "confidential"],
    capabilities: ["tool_calling", "long_context", "vision", "code", "reasoning"],
    latencyMs: 1300,
    selfHosted: false,
    notes: "Meta Model API. $4 / $20 per 1M tokens; cached input $0.20. No contributor tier.",
  },
  {
    id: "muse-spark-1.3",
    label: "Muse Spark 1.3",
    provider: "meta",
    tier: "balanced",
    contextWindow: 1_048_576,
    inputPerMTok: 1.25,
    outputPerMTok: 4.25,
    cachedInputPerMTok: 0.15,
    allowedDataClasses: ["public", "internal", "confidential"],
    capabilities: ["tool_calling", "long_context", "vision", "code"],
    latencyMs: 800,
    selfHosted: false,
    notes: "Meta Model API. $1.25 / $4.25 per 1M tokens; cached input $0.15.",
  },
  {
    id: "muse-spark-1.2",
    label: "Muse Spark 1.2",
    provider: "meta",
    tier: "balanced",
    contextWindow: 1_048_576,
    inputPerMTok: 1.25,
    outputPerMTok: 4.25,
    cachedInputPerMTok: 0.15,
    allowedDataClasses: ["public", "internal", "confidential"],
    capabilities: ["tool_calling", "long_context", "vision", "code"],
    latencyMs: 850,
    selfHosted: false,
    notes: "Meta Model API. Same token price as Spark 1.3.",
  },
  {
    id: "muse-spark-1.1",
    label: "Muse Spark 1.1",
    provider: "meta",
    tier: "fast",
    contextWindow: 1_048_576,
    inputPerMTok: 1.25,
    outputPerMTok: 4.25,
    cachedInputPerMTok: 0.15,
    allowedDataClasses: ["public", "internal"],
    capabilities: ["tool_calling", "code"],
    latencyMs: 500,
    selfHosted: false,
    notes: "Meta Model API. Standard-mode only; same $1.25 / $4.25 as Spark 1.3.",
  },
  {
    id: "selfhost/llama-4-70b",
    label: "Llama 4 70B (in-VPC)",
    provider: "selfhost",
    tier: "local",
    contextWindow: 128_000,
    inputPerMTok: 0.15,
    outputPerMTok: 0.45,
    allowedDataClasses: ["public", "internal", "confidential", "restricted"],
    capabilities: ["tool_calling", "code"],
    latencyMs: 650,
    selfHosted: true,
    notes: "Runs inside the customer VPC. Approved for restricted data.",
  },
  {
    id: "selfhost/qwen-3-coder-32b",
    label: "Qwen 3 Coder 32B (in-VPC)",
    provider: "selfhost",
    tier: "local",
    contextWindow: 128_000,
    inputPerMTok: 0.08,
    outputPerMTok: 0.22,
    allowedDataClasses: ["public", "internal", "confidential", "restricted"],
    capabilities: ["tool_calling", "code"],
    latencyMs: 480,
    selfHosted: true,
  },
];

export const MODEL_BY_ID: ReadonlyMap<string, Model> = new Map(
  MODEL_CATALOG.map((m) => [m.id, m]),
);

export const TIER_CAPABILITY: Record<ModelTier, number> = {
  frontier: 1,
  balanced: 0.72,
  fast: 0.5,
  local: 0.7,
};

export const TaskComplexitySchema = z.enum([
  "trivial",
  "standard",
  "complex",
  "critical",
]);
export type TaskComplexity = z.infer<typeof TaskComplexitySchema>;

/**
 * A lightweight resource envelope for a step. The router picks this from task
 * complexity before the step runs, so the UI can show what a task was budgeted
 * to consume without pretending to schedule real containers.
 */
export const HardwareTierSchema = z.enum(["light", "medium", "heavy"]);
export type HardwareTier = z.infer<typeof HardwareTierSchema>;

export interface HardwareProfile {
  tier: HardwareTier;
  vcpu: number;
  memoryMb: number;
  /** Present only for the GPU tier. */
  accelerator?: string;
  label: string;
}

export function hardwareForComplexity(complexity: TaskComplexity): HardwareProfile {
  switch (complexity) {
    case "critical":
      return {
        tier: "heavy",
        vcpu: 8,
        memoryMb: 16_384,
        accelerator: "16GB GPU",
        label: "8 vCPU / 16GB / GPU",
      };
    case "complex":
      return { tier: "medium", vcpu: 2, memoryMb: 4_096, label: "2 vCPU / 4GB" };
    case "standard":
      return { tier: "light", vcpu: 0.5, memoryMb: 512, label: "0.5 vCPU / 512MB" };
    case "trivial":
    default:
      return { tier: "light", vcpu: 0.25, memoryMb: 256, label: "0.25 vCPU / 256MB" };
  }
}

/** Capability floor the router demands for a complexity band. */
const COMPLEXITY_FLOOR: Record<TaskComplexity, number> = {
  trivial: 0.4,
  standard: 0.6,
  complex: 0.78,
  critical: 0.95,
};

export interface RouteRequest {
  complexity: TaskComplexity;
  dataClass: DataClass;
  requiredCapabilities?: Capability[];
  /** Conservative estimate used for cost scoring + budget pre-check. */
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  /** 0 = cost is irrelevant, 1 = cost is the only thing that matters. */
  costSensitivity?: number;
  latencySensitivity?: number;
  /** Hard pin, e.g. a user explicitly selecting a model. Bypasses scoring. */
  pinnedModelId?: string;
  /** Models excluded by org policy. */
  deniedModelIds?: readonly string[];
}

export interface RouteCandidate {
  model: string;
  score: number;
  estimatedCostUsd: number;
  rejectedReason?: string;
}

export interface RouteResult {
  chosenModel: string;
  reason: string;
  estimatedCostUsd: number;
  candidates: RouteCandidate[];
}

export function estimateCostUsd(
  model: Model,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number {
  const cached = Math.min(Math.max(cachedInputTokens, 0), inputTokens);
  const fresh = inputTokens - cached;
  const cachedRate = model.cachedInputPerMTok ?? model.inputPerMTok;
  return (
    (fresh / 1_000_000) * model.inputPerMTok +
    (cached / 1_000_000) * cachedRate +
    (outputTokens / 1_000_000) * model.outputPerMTok
  );
}

const META_PROVISION_ORDER: Record<TaskComplexity, readonly string[]> = {
  critical: ["muse-wonder-1.0", "muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1"],
  complex: ["muse-wonder-1.0", "muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1"],
  standard: ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1", "muse-wonder-1.0"],
  trivial: ["muse-spark-1.1", "muse-spark-1.2", "muse-spark-1.3", "muse-wonder-1.0"],
};

/** True when the id is a Meta Model API Muse model. */
export function isMetaModelId(id: string): boolean {
  const model = MODEL_BY_ID.get(id);
  return model?.provider === "meta" || id.startsWith("muse-");
}

/**
 * Pin a Meta Model API model for a spawned task. Critical/complex work gets
 * Wonder; everyday work gets Spark 1.3; lookups get Spark 1.1.
 */
export function provisionMetaModel(
  complexity: TaskComplexity,
  deniedModelIds: readonly string[] = [],
): string {
  const denied = new Set(deniedModelIds);
  const picked = META_PROVISION_ORDER[complexity].find((id) => !denied.has(id) && MODEL_BY_ID.has(id));
  return picked ?? "muse-spark-1.3";
}

/**
 * Score every model on capability fit vs. cost vs. latency, filter out
 * anything the data classification or capability floor forbids, pick the best.
 */
export function routeModel(
  request: RouteRequest,
  catalog: readonly Model[] = MODEL_CATALOG,
): RouteResult {
  const costSensitivity = request.costSensitivity ?? 0.45;
  const latencySensitivity = request.latencySensitivity ?? 0.2;
  const required = request.requiredCapabilities ?? [];
  const floor = COMPLEXITY_FLOOR[request.complexity];
  const denied = new Set(request.deniedModelIds ?? []);

  if (request.pinnedModelId) {
    const pinned = catalog.find((m) => m.id === request.pinnedModelId);
    if (!pinned) {
      throw new Error(`Pinned model not in catalog: ${request.pinnedModelId}`);
    }
    const allowed = pinned.allowedDataClasses.includes(request.dataClass);
    return {
      chosenModel: pinned.id,
      reason: allowed
        ? `Pinned by agent policy; ${request.dataClass} data is permitted.`
        : `Pinned by agent policy. WARNING: model is not approved for ${request.dataClass} data.`,
      estimatedCostUsd: estimateCostUsd(
        pinned,
        request.estimatedInputTokens,
        request.estimatedOutputTokens,
      ),
      candidates: [
        {
          model: pinned.id,
          score: 1,
          estimatedCostUsd: estimateCostUsd(
            pinned,
            request.estimatedInputTokens,
            request.estimatedOutputTokens,
          ),
          rejectedReason: allowed
            ? undefined
            : `data class ${request.dataClass} not approved`,
        },
      ],
    };
  }

  const candidates: RouteCandidate[] = [];

  // Cost is scored relatively, so the cheapest plausible model scores 1.
  const maxCost = Math.max(
    ...catalog.map((m) =>
      estimateCostUsd(m, request.estimatedInputTokens, request.estimatedOutputTokens),
    ),
    1e-9,
  );

  for (const model of catalog) {
    const cost = estimateCostUsd(
      model,
      request.estimatedInputTokens,
      request.estimatedOutputTokens,
    );

    let rejectedReason: string | undefined;
    if (denied.has(model.id)) {
      rejectedReason = "blocked by org model policy";
    } else if (!model.allowedDataClasses.includes(request.dataClass)) {
      rejectedReason = `not approved for ${request.dataClass} data`;
    } else if (!required.every((c) => model.capabilities.includes(c))) {
      rejectedReason = "missing required capability";
    } else if (model.contextWindow < request.estimatedInputTokens + 4_000) {
      rejectedReason = "context window too small";
    } else if (TIER_CAPABILITY[model.tier] < floor) {
      rejectedReason = `capability below floor for ${request.complexity} task`;
    }

    if (rejectedReason) {
      candidates.push({ model: model.id, score: 0, estimatedCostUsd: cost, rejectedReason });
      continue;
    }

    const costScore = 1 - Math.min(cost / maxCost, 1);
    const latencyScore = 1 - Math.min(model.latencyMs / 2000, 1);
    const capabilityScore = TIER_CAPABILITY[model.tier];
    const capabilityHeadroom = Math.min(
      1,
      capabilityScore / Math.max(floor, 1e-9),
    );
    // Small bonus for staying off third-party inference when data is sensitive.
    const residencyBonus =
      request.dataClass === "restricted" || request.dataClass === "confidential"
        ? model.selfHosted
          ? 0.12
          : 0
        : 0;

    const score =
      capabilityHeadroom * (1 - costSensitivity - latencySensitivity) +
      costScore * costSensitivity +
      latencyScore * latencySensitivity +
      residencyBonus;

    candidates.push({
      model: model.id,
      score: Number(score.toFixed(4)),
      estimatedCostUsd: cost,
    });
  }

  const viable = candidates
    .filter((c) => !c.rejectedReason)
    .sort((a, b) => b.score - a.score);

  const best = viable[0];
  if (!best) {
    throw new Error(
      `No model satisfies ${request.complexity}/${request.dataClass} requirements.`,
    );
  }

  const rejectedCount = candidates.length - viable.length;
  const cheaperViable = viable
    .filter((c) => c.estimatedCostUsd < best.estimatedCostUsd)
    .slice(0, 1);

  const reason =
    `${request.complexity} task on ${request.dataClass} data; ` +
    `cheapest viable model met the capability floor` +
    (cheaperViable.length
      ? ` (${cheaperViable[0]?.model} was cheaper but scored lower on fit)`
      : "") +
    (rejectedCount ? `; ${rejectedCount} model(s) excluded by policy` : "") +
    ".";

  return {
    chosenModel: best.model,
    reason,
    estimatedCostUsd: best.estimatedCostUsd,
    candidates,
  };
}
