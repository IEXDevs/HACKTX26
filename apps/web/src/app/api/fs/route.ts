import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { env, newId } from "@/lib/env";
import { getAgent, getWorkspaceContext, requireWorkspace } from "@/lib/queries";
import { AgentSandbox } from "@/lib/runtime/sandbox";

export const dynamic = "force-dynamic";

const MAX_EDIT_BYTES = 256 * 1024;

async function sandboxFor(agentId: string) {
  const workspace = await requireWorkspace();
  const agent = await getAgent(agentId);
  if (!agent || agent.workspaceId !== workspace.id) {
    return { error: Response.json({ error: "Agent not found." }, { status: 404 }) } as const;
  }
  const sandbox = new AgentSandbox(env.sandboxRoot, workspace.id, agent.id);
  if (!sandbox.exists()) {
    // Same starter tree the runtime provisions before a run, so the console is
    // never an empty illusion.
    sandbox.provision({
      agentName: agent.name,
      role: agent.role,
      summary: agent.summary || agent.instructions.slice(0, 200),
    });
  }
  return { workspace, agent, sandbox } as const;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");
  const mode = url.searchParams.get("mode") ?? "tree";
  const relativePath = url.searchParams.get("path") ?? ".";

  if (!agentId) {
    return Response.json({ error: "`agentId` is required." }, { status: 400 });
  }

  const ctx = await sandboxFor(agentId);
  if ("error" in ctx) return ctx.error;

  try {
    if (mode === "read") {
      const content = ctx.sandbox.read(relativePath === "." ? "README.md" : relativePath);
      return Response.json({
        agentId,
        path: relativePath,
        content,
        bytes: Buffer.byteLength(content, "utf8"),
        root: ctx.sandbox.root,
      });
    }

    if (mode === "tree") {
      return Response.json({
        agentId,
        tree: ctx.sandbox.tree(),
        root: ctx.sandbox.root,
      });
    }

    return Response.json({ error: "mode must be 'tree' or 'read'." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

const WriteBody = z.object({
  agentId: z.string().min(1),
  path: z.string().min(1).max(400),
  content: z.string(),
});

export async function POST(request: NextRequest) {
  const parsed = WriteBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Expected { agentId, path, content }.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  if (Buffer.byteLength(parsed.data.content, "utf8") > MAX_EDIT_BYTES) {
    return Response.json({ error: "Edits are limited to 256 KB." }, { status: 413 });
  }

  const ctx = await sandboxFor(parsed.data.agentId);
  if ("error" in ctx) return ctx.error;

  try {
    const result = ctx.sandbox.write(parsed.data.path, parsed.data.content);
    const { user } = await getWorkspaceContext();
    await getDb().insert(auditLog).values({
      id: newId("aud"),
      workspaceId: ctx.workspace.id,
      actor: user?.email ?? "operator@local",
      action: "sandbox.write",
      targetType: "agent",
      targetId: ctx.agent.id,
      detail: { path: parsed.data.path, bytes: result.bytes },
      at: new Date(),
    });
    return Response.json({
      ok: true,
      path: parsed.data.path,
      bytes: result.bytes,
      tree: ctx.sandbox.tree(),
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");
  const relativePath = url.searchParams.get("path");
  if (!agentId || !relativePath) {
    return Response.json({ error: "`agentId` and `path` are required." }, { status: 400 });
  }

  const ctx = await sandboxFor(agentId);
  if ("error" in ctx) return ctx.error;

  try {
    ctx.sandbox.remove(relativePath);
    const { user } = await getWorkspaceContext();
    await getDb().insert(auditLog).values({
      id: newId("aud"),
      workspaceId: ctx.workspace.id,
      actor: user?.email ?? "operator@local",
      action: "sandbox.remove",
      targetType: "agent",
      targetId: ctx.agent.id,
      detail: { path: relativePath },
      at: new Date(),
    });
    return Response.json({ ok: true, tree: ctx.sandbox.tree() });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
