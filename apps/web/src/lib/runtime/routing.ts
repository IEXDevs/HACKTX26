import { routeModel, type DataClass } from "@agent-os/core";
import type { AgentRow } from "../db/schema";

export function routeForAgent(agent: AgentRow, dataClass: DataClass, prompt: string, deniedModelIds: readonly string[]) {
  return routeModel({
    complexity: agent.complexity, dataClass, requiredCapabilities: ["tool_calling"],
    estimatedInputTokens: Math.max(3_000, Math.ceil(prompt.length / 4) + 2_000), estimatedOutputTokens: 900,
    costSensitivity: agent.modelPolicy.costSensitivity, latencySensitivity: agent.modelPolicy.latencySensitivity,
    pinnedModelId: agent.modelPolicy.mode === "pinned" ? agent.modelPolicy.pinnedModelId ?? undefined : undefined,
    deniedModelIds: [...deniedModelIds, ...agent.modelPolicy.deniedModelIds],
  });
}
