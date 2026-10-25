import { env } from "@/lib/env";
import { AnthropicGateway } from "./gateway-anthropic";
import { OpenAiGateway } from "./gateway-openai";
import type { ModelGateway } from "./types";

/**
 * Real-inference gateway, selected by MODEL_GATEWAY. Only used when the run is
 * dispatched in `live` mode and the matching key is present.
 */
export function createLiveGateway(): ModelGateway {
  switch (env.modelGateway) {
    case "openai":
      return new OpenAiGateway(env.openai.apiKey, env.openai.baseUrl);
    case "anthropic":
      return new AnthropicGateway(env.anthropic.apiKey, env.anthropic.baseUrl);
    case "scripted":
    default:
      throw new Error(
        "MODEL_GATEWAY=scripted — the runtime uses the scripted plan, not a live gateway.",
      );
  }
}

export function liveGatewayAvailable(): boolean {
  if (env.modelGateway === "openai") return env.openai.apiKey.length > 0;
  if (env.modelGateway === "anthropic") return env.anthropic.apiKey.length > 0;
  return false;
}
