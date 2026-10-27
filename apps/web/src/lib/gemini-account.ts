import { accountGeminiKey } from "./account-assets";
import { env } from "./env";

/** Production voice always uses the caller's key. Local development can use its env file. */
export async function voiceApiKey(accountId: string): Promise<string | null> {
  return await accountGeminiKey(accountId) ?? (env.nodeEnv !== "production" ? env.gemini.apiKey || null : null);
}
