import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLog, credentials } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";
import { openSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/**
 * Proves the vault is real: decrypts with AES-256-GCM, which fails if the
 * ciphertext or auth tag was tampered with. The plaintext is discarded here —
 * only metadata crosses the wire.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const workspace = await requireWorkspace();
  const db = await getDb();

  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.id, id))
    .limit(1);

  if (!credential || credential.workspaceId !== workspace.id) {
    return Response.json({ error: "Credential not found." }, { status: 404 });
  }

  let ok: boolean;
  let plaintextBytes = 0;
  try {
    const plaintext = openSecret({
      ciphertext: credential.ciphertext,
      iv: credential.iv,
      authTag: credential.authTag,
    });
    plaintextBytes = Buffer.byteLength(plaintext, "utf8");
    ok = true;
  } catch {
    ok = false;
  }

  const { user } = await getWorkspaceUser();
  await db.insert(auditLog).values({
    id: newId("aud"),
    workspaceId: workspace.id,
    actor: user?.email ?? "operator@local",
    action: "credential.verified",
    targetType: "credential",
    targetId: id,
    detail: { ok, algorithm: "aes-256-gcm", plaintextBytes, plaintextReturned: false },
    at: new Date(),
  });

  return Response.json({
    ok,
    algorithm: "aes-256-gcm",
    hint: credential.hint,
    scopes: credential.scopes,
    plaintextBytes,
    plaintextReturned: false,
    checkedAt: new Date().toISOString(),
  });
}
