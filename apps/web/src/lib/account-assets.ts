import { cache } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { getSessionUser } from "./auth";
import { operatorIdFor } from "./connectors";
import { getDb } from "./db/client";
import { credentials, kbDocuments } from "./db/schema";
import { env, newId, supabaseAuthEnabled } from "./env";
import { getWorkspaceUser } from "./queries";
import { openSecret, sealSecret } from "./secrets";
import { sealDocument } from "./runtime/kb";

export interface AssetAccount { workspaceId: string; accountId: string }
export class AssetError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Ownership comes from the verified session, never a submitted account ID. */
export const requireAssetAccount = cache(async (): Promise<AssetAccount> => {
  const { workspace, user } = await getWorkspaceUser();
  const session = await getSessionUser();
  if (!session && (env.nodeEnv === "production" || supabaseAuthEnabled() || !user)) throw new AssetError("Sign in to manage your saved items.", 401);
  const accountId = operatorIdFor(session?.id, user?.id);
  // Older documents used the author's email. Claim only that verified author's rows.
  if (session?.email) {
    const db = await getDb();
    const legacy = await db.select({ id: kbDocuments.id, body: kbDocuments.body }).from(kbDocuments)
      .where(and(eq(kbDocuments.workspaceId, workspace.id), eq(kbDocuments.addedBy, session.email)));
    for (const row of legacy) {
      await db.update(kbDocuments).set({ addedBy: accountId, body: row.body.startsWith("sealed-document:v1:") ? row.body : sealDocument(row.body) })
        .where(and(eq(kbDocuments.id, row.id), eq(kbDocuments.addedBy, session.email)));
    }
  }
  return { workspaceId: workspace.id, accountId };
});

export function keyOwner(account: AssetAccount) {
  return and(eq(credentials.workspaceId, account.workspaceId), eq(credentials.createdBy, account.accountId));
}

/** Deliberately excludes the ciphertext, IV, tag, hint, value, and value length. */
export async function listAccountKeys(account: AssetAccount) {
  return (await getDb()).select({ id: credentials.id, name: credentials.name, purpose: credentials.connectorId })
    .from(credentials).where(and(keyOwner(account), inArray(credentials.connectorId, ["muse", "gemini"])));
}

export async function addAccountKey(account: AssetAccount, purpose: string, value: string) {
  if (!["muse", "gemini"].includes(purpose) || value.length < 8 || value.length > 8192 || /\s/.test(value)) {
    throw new AssetError("Choose Muse or Gemini and enter a valid key.", 400);
  }
  const name = purpose === "gemini" ? "Gemini (voice)" : "Muse";
  const [saved] = await (await getDb()).insert(credentials).values({
    id: newId("cred"), workspaceId: account.workspaceId, connectorId: purpose, name,
    ...sealSecret(value), hint: "Hidden", scopes: [], createdBy: account.accountId, createdAt: new Date(),
  }).onConflictDoNothing().returning({ id: credentials.id });
  if (!saved) throw new AssetError(`A ${name} key is already saved. Delete it before adding a replacement.`, 409);
  return saved;
}

export async function deleteAccountKey(account: AssetAccount, id: string) {
  const rows = await (await getDb()).delete(credentials)
    .where(and(keyOwner(account), eq(credentials.id, id), inArray(credentials.connectorId, ["muse", "gemini"])))
    .returning({ id: credentials.id });
  return rows.length > 0;
}

/** Server-only model use. There is no HTTP read or reveal endpoint for this value. */
export async function accountMuseKey(accountId: string): Promise<string | null> {
  return accountKey(accountId, "muse");
}

export async function accountGeminiKey(accountId: string): Promise<string | null> {
  return accountKey(accountId, "gemini");
}

async function accountKey(accountId: string, purpose: "muse" | "gemini"): Promise<string | null> {
  const [row] = await (await getDb()).select().from(credentials)
    .where(and(eq(credentials.createdBy, accountId), eq(credentials.connectorId, purpose))).limit(1);
  return row ? openSecret(row) : null;
}

export function assetFailure(error: unknown) {
  return Response.json({ error: error instanceof AssetError ? error.message : "Could not save this change." },
    { status: error instanceof AssetError ? error.status : 500 });
}
