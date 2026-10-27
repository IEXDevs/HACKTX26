import { accountMuseKey, requireAssetAccount } from "@/lib/account-assets";
import { env } from "@/lib/env";
import { AnthropicGateway } from "./gateway-anthropic";
import { OpenAiGateway } from "./gateway-openai";
import type { ModelGateway } from "./types";

async function museKey(accountId?: string | null): Promise<string | null> {
  if (accountId === undefined) {
    try { accountId = (await requireAssetAccount()).accountId; }
    catch { return null; }
  }
  return accountId ? accountMuseKey(accountId) : null;
}

/** Account keys take precedence. Environment keys remain a local development fallback. */
export async function createLiveGateway(accountId?: string | null): Promise<ModelGateway> {
  const key = await museKey(accountId);
  if (key) return new OpenAiGateway(key, "https://api.meta.ai/v1");
  if (env.nodeEnv !== "production") {
    if (env.modelGateway === "openai" && env.openai.apiKey) return new OpenAiGateway(env.openai.apiKey, env.openai.baseUrl);
    if (env.modelGateway === "anthropic" && env.anthropic.apiKey) return new AnthropicGateway(env.anthropic.apiKey, env.anthropic.baseUrl);
  }
  throw new Error("Add your Muse key in Connectors to use a live model.");
}

export async function liveGatewayAvailable(accountId?: string | null): Promise<boolean> {
  if (await museKey(accountId)) return true;
  if (env.nodeEnv === "production") return false;
  if (env.modelGateway === "openai") return env.openai.apiKey.length > 0;
  if (env.modelGateway === "anthropic") return env.anthropic.apiKey.length > 0;
  return false;
}
