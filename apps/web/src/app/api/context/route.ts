import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { operatorIdFor, persistContextFile } from "@/lib/connectors";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { env, newId } from "@/lib/env";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";
import {
  isContextStub,
  WorkspaceContextFile,
} from "@/lib/runtime/workspace-context";

export const dynamic = "force-dynamic";

const Body = z.object({
  content: z.string().max(256_000).optional(),
  include: z.string().min(2).max(2000).optional(),
  remove: z.string().min(2).max(2000).optional(),
});

function fileForWorkspace(workspaceId: string) {
  return new WorkspaceContextFile(env.sandboxRoot, workspaceId);
}

export async function GET() {
  const { workspace } = await getWorkspaceUser();
  const file = fileForWorkspace(workspace.id);
  const content = file.ensure();
  return Response.json({
    path: "CONTEXT.md",
    content,
    stub: isContextStub(content),
    bytes: Buffer.byteLength(content, "utf8"),
  });
}

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { content } or { include } or { remove }." }, { status: 400 });
  }
  const workspace = await requireWorkspace();
  const file = fileForWorkspace(workspace.id);
  file.ensure();

  let content: string;
  if (parsed.data.include) {
    content = file.apply({ op: "include", text: parsed.data.include }).content;
  } else if (parsed.data.remove) {
    content = file.apply({ op: "remove", text: parsed.data.remove }).content;
  } else if (parsed.data.content !== undefined) {
    file.write(parsed.data.content);
    content = file.read();
  } else {
    return Response.json({ error: "Expected { content } or { include } or { remove }." }, { status: 400 });
  }

  const { user } = await getWorkspaceUser();
  const session = await getSessionUser();
  await persistContextFile(workspace.id, content, operatorIdFor(session?.id, user?.id));
  await getDb().insert(auditLog).values({
    id: newId("aud"),
    workspaceId: workspace.id,
    actor: user?.email ?? "operator@local",
    action: "context.write",
    targetType: "workspace",
    targetId: workspace.id,
    detail: {
      include: parsed.data.include,
      remove: parsed.data.remove,
      bytes: Buffer.byteLength(content, "utf8"),
    },
    at: new Date(),
  });

  return Response.json({
    ok: true,
    path: "CONTEXT.md",
    content,
    stub: isContextStub(content),
    bytes: Buffer.byteLength(content, "utf8"),
  });
}
