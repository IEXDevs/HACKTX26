/**
 * Connector catalog, per-user links, grants, and CONTEXT.md sync.
 *
 * SQLite is the local source of truth for a run. Every write also mirrors to
 * Supabase when the service role is configured.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "./db/client";
import {
  agents,
  connectedAccounts,
  connectorCatalog,
  connectorGrants,
  workspaceContexts,
  type AgentRow,
} from "./db/schema";
import {
  SERPAPI_TOOLKIT,
  SERPAPI_TOOLKIT_INFO,
  POPULAR_TOOLKITS,
  listConnectedFromComposio,
  listToolkitActions,
  normalizeToolkit,
  parseConnectorList,
  searchToolkits,
  startToolkitLink,
  disconnectToolkit as composioDisconnect,
  type ToolkitInfo,
} from "./composio";
import { env, newId, serpApiEnabled } from "./env";
import { observabilityEnabled } from "./env";
import { supabaseAdmin } from "./supabase";
import { parseGithubMetadata, type GithubWorkingRepo } from "./github-repo";
import {
  hasContextContent,
  upsertConnectedToolsSection,
  WorkspaceContextFile,
} from "./runtime/workspace-context";

export { parseConnectorList, SERPAPI_TOOLKIT };

export interface ConnectorView {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  category: string | null;
  popular: boolean;
  builtin: boolean;
  status: "connected" | "pending" | "disconnected" | "error";
  connected: boolean;
  repo?: string | null;
  branch?: string | null;
}

export function operatorIdFor(sessionId: string | null | undefined, localUserId?: string | null): string {
  if (sessionId) return sessionId;
  if (localUserId) return `local:${localUserId}`;
  return "local:anonymous";
}

async function upsertCatalog(rows: ToolkitInfo[]): Promise<void> {
  const db = getDb();
  const now = new Date();
  for (const row of rows) {
    await db
      .insert(connectorCatalog)
      .values({
        toolkit: row.slug,
        name: row.name,
        description: row.description,
        logoUrl: row.logoUrl,
        category: row.category,
        authSchemes: [],
        popular: row.popular,
        metadata: {},
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: connectorCatalog.toolkit,
        set: {
          name: row.name,
          description: row.description,
          logoUrl: row.logoUrl,
          category: row.category,
          popular: row.popular,
          updatedAt: now,
        },
      });
  }
  await mirrorCatalog(rows);
}

async function mirrorCatalog(rows: ToolkitInfo[]): Promise<void> {
  const client = supabaseAdmin();
  if (!client || !observabilityEnabled()) return;
  for (const row of rows) {
    const { error } = await client.from("connector_catalog").upsert(
      {
        toolkit: row.slug,
        name: row.name,
        description: row.description,
        logo_url: row.logoUrl,
        category: row.category,
        auth_schemes: [],
        popular: row.popular,
        metadata: {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "toolkit" },
    );
    if (error) console.warn("[supabase] connector_catalog:", error.message);
  }
}

async function mirrorAccount(row: {
  id: string;
  workspaceId: string;
  userId: string;
  toolkit: string;
  toolkitName: string;
  composioAccountId: string | null;
  authConfigId: string | null;
  status: string;
  scopes: string[];
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const client = supabaseAdmin();
  if (!client || !observabilityEnabled()) return;
  const { error } = await client.from("connected_accounts").upsert(
    {
      id: row.id,
      workspace_id: row.workspaceId,
      user_id: row.userId,
      toolkit: row.toolkit,
      toolkit_name: row.toolkitName,
      composio_account_id: row.composioAccountId,
      auth_config_id: row.authConfigId,
      status: row.status,
      scopes: row.scopes,
      metadata: row.metadata ?? {},
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,user_id,toolkit" },
  );
  if (error) console.warn("[supabase] connected_accounts:", error.message);
}

async function mirrorGrants(workspaceId: string, agentId: string, toolkits: string[], grantedBy: string | null): Promise<void> {
  const client = supabaseAdmin();
  if (!client || !observabilityEnabled()) return;
  await client.from("connector_grants").delete().eq("agent_id", agentId);
  if (toolkits.length === 0) return;
  const { error } = await client.from("connector_grants").insert(
    toolkits.map((toolkit) => ({
      workspace_id: workspaceId,
      agent_id: agentId,
      toolkit,
      granted_by: grantedBy,
    })),
  );
  if (error) console.warn("[supabase] connector_grants:", error.message);
}

export async function mirrorContext(workspaceId: string, content: string, updatedBy: string | null): Promise<void> {
  const client = supabaseAdmin();
  if (!client || !observabilityEnabled()) return;
  const { error } = await client.from("workspace_contexts").upsert(
    {
      workspace_id: workspaceId,
      content,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (error) console.warn("[supabase] workspace_contexts:", error.message);
}

export async function seedPopularCatalog(): Promise<void> {
  await upsertCatalog([SERPAPI_TOOLKIT_INFO, ...POPULAR_TOOLKITS]);
}

export async function syncConnectedAccounts(workspaceId: string, userId: string): Promise<void> {
  const remote = await listConnectedFromComposio(userId);
  if (!remote) return;
  const db = getDb();
  const now = new Date();
  const seen = new Set<string>();
  for (const item of remote) {
    seen.add(item.toolkit);
    const [existing] = await db
      .select()
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.workspaceId, workspaceId),
          eq(connectedAccounts.userId, userId),
          eq(connectedAccounts.toolkit, item.toolkit),
        ),
      )
      .limit(1);
    const row = {
      id: existing?.id ?? newId("ca"),
      workspaceId,
      userId,
      toolkit: item.toolkit,
      toolkitName: item.toolkitName,
      composioAccountId: item.accountId,
      authConfigId: item.authConfigId,
      status: item.status,
      scopes: [] as string[],
      metadata: existing?.metadata ?? {},
      lastSyncAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db
      .insert(connectedAccounts)
      .values(row)
      .onConflictDoUpdate({
        target: [connectedAccounts.workspaceId, connectedAccounts.userId, connectedAccounts.toolkit],
        set: {
          toolkitName: row.toolkitName,
          composioAccountId: row.composioAccountId,
          authConfigId: row.authConfigId,
          status: row.status,
          lastSyncAt: now,
          updatedAt: now,
        },
      });
    await mirrorAccount(row);
  }

  const locals = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.userId, userId)));
  for (const local of locals) {
    if (seen.has(local.toolkit) || local.status === "disconnected") continue;
    await db
      .update(connectedAccounts)
      .set({ status: "disconnected", lastSyncAt: now, updatedAt: now })
      .where(eq(connectedAccounts.id, local.id));
    await mirrorAccount({ ...local, status: "disconnected" });
  }
}

export async function listConnectorViews(input: {
  workspaceId: string;
  userId: string;
  query?: string;
}): Promise<{ connectors: ConnectorView[]; composio: boolean; serpapi: boolean }> {
  const query = input.query?.trim() ?? "";
  await seedPopularCatalog();
  await syncConnectedAccounts(input.workspaceId, input.userId).catch(() => undefined);

  const [catalog, accounts] = await Promise.all([
    query ? searchToolkits(query) : Promise.resolve([SERPAPI_TOOLKIT_INFO, ...POPULAR_TOOLKITS]),
    getDb()
      .select()
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.workspaceId, input.workspaceId), eq(connectedAccounts.userId, input.userId))),
  ]);

  const byToolkit = new Map(accounts.map((row) => [row.toolkit, row]));
  const connectors: ConnectorView[] = catalog.map((item) => {
    const builtin = item.slug === SERPAPI_TOOLKIT;
    const account = byToolkit.get(item.slug);
    const status: ConnectorView["status"] = builtin
      ? serpApiEnabled()
        ? "connected"
        : "disconnected"
      : account?.status ?? "disconnected";
    const github = item.slug === "github" ? parseGithubMetadata(account?.metadata) : null;
    return {
      slug: item.slug,
      name: item.name,
      description: item.description,
      logoUrl: item.logoUrl,
      category: item.category,
      popular: item.popular,
      builtin,
      status,
      connected: status === "connected",
      repo: github?.repo ?? null,
      branch: github?.branch ?? null,
    };
  });

  if (!query) {
    for (const account of accounts) {
      if (connectors.some((item) => item.slug === account.toolkit)) continue;
      const github = account.toolkit === "github" ? parseGithubMetadata(account.metadata) : null;
      connectors.push({
        slug: account.toolkit,
        name: account.toolkitName,
        description: "",
        logoUrl: null,
        category: null,
        popular: false,
        builtin: false,
        status: account.status,
        connected: account.status === "connected",
        repo: github?.repo ?? null,
        branch: github?.branch ?? null,
      });
    }
  }

  connectors.sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.popular) - Number(a.popular) || a.name.localeCompare(b.name));
  return { connectors, composio: Boolean(env.composio.apiKey), serpapi: serpApiEnabled() };
}

export async function getConnectedComposioAccountId(
  workspaceId: string,
  userId: string,
  toolkit: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.workspaceId, workspaceId),
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.toolkit, normalizeToolkit(toolkit)),
        eq(connectedAccounts.status, "connected"),
      ),
    )
    .limit(1);
  return row?.composioAccountId ?? null;
}

export async function getGithubWorkingRepo(
  workspaceId: string,
  userId: string,
): Promise<GithubWorkingRepo | null> {
  const [row] = await getDb()
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.workspaceId, workspaceId),
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.toolkit, "github"),
        eq(connectedAccounts.status, "connected"),
      ),
    )
    .limit(1);
  return parseGithubMetadata(row?.metadata);
}

export async function setGithubWorkingRepo(
  workspaceId: string,
  userId: string,
  repo: string,
  branch?: string,
): Promise<GithubWorkingRepo> {
  const parsed = parseGithubMetadata({ repo, branch: branch?.trim() || "main" });
  if (!parsed) throw new Error("Use owner/name for the repository, like acme/checkout.");
  const [row] = await getDb()
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.workspaceId, workspaceId),
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.toolkit, "github"),
        eq(connectedAccounts.status, "connected"),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Connect GitHub before picking a repository.");
  const metadata = { ...(row.metadata ?? {}), repo: parsed.repo, branch: parsed.branch };
  await getDb()
    .update(connectedAccounts)
    .set({ metadata, updatedAt: new Date() })
    .where(eq(connectedAccounts.id, row.id));
  await mirrorAccount({ ...row, metadata });
  return parsed;
}

export async function connectedToolkitsFor(workspaceId: string, userId: string): Promise<string[]> {
  await syncConnectedAccounts(workspaceId, userId).catch(() => undefined);
  const rows = await getDb()
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.workspaceId, workspaceId),
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.status, "connected"),
      ),
    );
  const slugs = rows.map((row) => row.toolkit);
  if (serpApiEnabled()) slugs.unshift(SERPAPI_TOOLKIT);
  return [...new Set(slugs)];
}

export function connectorsForAgent(agent: Pick<AgentRow, "role">, orchestratorConnectors: string[]): string[] {
  if (agent.role === "orchestrator") return orchestratorConnectors;
  return [];
}

export async function persistConnectorGrants(
  workspaceId: string,
  agentId: string,
  toolkits: string[],
  grantedBy: string | null,
): Promise<void> {
  const db = getDb();
  await db.delete(connectorGrants).where(eq(connectorGrants.agentId, agentId));
  if (toolkits.length > 0) {
    await db.insert(connectorGrants).values(
      toolkits.map((toolkit) => ({
        id: newId("cgr"),
        workspaceId,
        agentId,
        toolkit,
        grantedBy,
        createdAt: new Date(),
      })),
    );
  }
  await db
    .update(agents)
    .set({ allowedConnectors: toolkits, updatedAt: new Date() })
    .where(eq(agents.id, agentId));
  await mirrorGrants(workspaceId, agentId, toolkits, grantedBy);
}

export async function beginConnect(input: {
  workspaceId: string;
  userId: string;
  toolkit: string;
  callbackUrl: string;
}): Promise<{ redirectUrl: string }> {
  const slug = normalizeToolkit(input.toolkit);
  if (slug === SERPAPI_TOOLKIT) {
    throw new Error("Web search is a platform tool. Set SERPAPI_API_KEY instead of linking it.");
  }
  const { redirectUrl } = await startToolkitLink(input.userId, slug, input.callbackUrl);
  const now = new Date();
  const known = POPULAR_TOOLKITS.find((item) => item.slug === slug);
  await getDb()
    .insert(connectedAccounts)
    .values({
      id: newId("ca"),
      workspaceId: input.workspaceId,
      userId: input.userId,
      toolkit: slug,
      toolkitName: known?.name ?? slug,
      composioAccountId: null,
      authConfigId: null,
      status: "pending",
      scopes: [],
      metadata: {},
      lastSyncAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [connectedAccounts.workspaceId, connectedAccounts.userId, connectedAccounts.toolkit],
      set: { status: "pending", updatedAt: now },
    });
  const [pending] = await getDb()
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.workspaceId, input.workspaceId),
        eq(connectedAccounts.userId, input.userId),
        eq(connectedAccounts.toolkit, slug),
      ),
    )
    .limit(1);
  if (pending) await mirrorAccount(pending);
  return { redirectUrl };
}

export async function endConnect(workspaceId: string, userId: string): Promise<void> {
  await syncConnectedAccounts(workspaceId, userId);
  await refreshContextCatalog(workspaceId, userId);
}

export async function disconnectAccount(workspaceId: string, userId: string, toolkit: string): Promise<void> {
  const slug = normalizeToolkit(toolkit);
  if (slug === SERPAPI_TOOLKIT) {
    throw new Error("Web search is controlled by SERPAPI_API_KEY, not a per-user link.");
  }
  await composioDisconnect(userId, slug);
  await getDb()
    .delete(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.workspaceId, workspaceId),
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.toolkit, slug),
      ),
    );
  const client = supabaseAdmin();
  if (client && observabilityEnabled()) {
    await client
      .from("connected_accounts")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .eq("toolkit", slug);
  }
  await refreshContextCatalog(workspaceId, userId);
}

export async function persistContextFile(
  workspaceId: string,
  content: string,
  updatedBy: string | null,
): Promise<void> {
  const file = new WorkspaceContextFile(env.sandboxRoot, workspaceId);
  file.write(content);
  await getDb()
    .insert(workspaceContexts)
    .values({
      workspaceId,
      content,
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workspaceContexts.workspaceId,
      set: { content, updatedBy, updatedAt: new Date() },
    });
  await mirrorContext(workspaceId, content, updatedBy);
}

export async function hydrateContextFromStores(workspaceId: string): Promise<string> {
  const file = new WorkspaceContextFile(env.sandboxRoot, workspaceId);
  file.ensure();
  const content = file.read();
  if (hasContextContent(content)) return content;

  const [local] = await getDb()
    .select()
    .from(workspaceContexts)
    .where(eq(workspaceContexts.workspaceId, workspaceId))
    .limit(1);
  if (local?.content && hasContextContent(local.content)) {
    file.write(local.content);
    return local.content;
  }

  const client = supabaseAdmin();
  if (client && observabilityEnabled()) {
    const { data } = await client
      .from("workspace_contexts")
      .select("content")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (data?.content && typeof data.content === "string" && hasContextContent(data.content)) {
      file.write(data.content);
      return data.content;
    }
  }
  return content;
}

export async function refreshContextCatalog(workspaceId: string, userId: string): Promise<string> {
  const content = await hydrateContextFromStores(workspaceId);
  const slugs = await connectedToolkitsFor(workspaceId, userId);
  const lines = ["## Connected tools", ""];
  if (slugs.length === 0) {
    lines.push("None linked yet. The operator connects apps on the Connectors page.");
    lines.push("Orchestrators may then call connector.call / web.search. Subagents only receive the toolkits passed in agent.delegate connectors.");
  } else {
    lines.push("The operator linked these apps. Use connector.call with toolkit + action. Writes need approval.");
    lines.push("When delegating, pass `connectors` to grant a subset to the child.");
    lines.push("");
    for (const slug of slugs) {
      const known =
        slug === SERPAPI_TOOLKIT
          ? SERPAPI_TOOLKIT_INFO
          : POPULAR_TOOLKITS.find((item) => item.slug === slug);
      const actions = await listToolkitActions(userId, slug).catch(() => []);
      const actionList =
        actions.length > 0
          ? actions
              .slice(0, 8)
              .map((action) => action.slug)
              .join(", ")
          : slug === SERPAPI_TOOLKIT
            ? "web.search"
            : "(actions load after connect)";
      lines.push(`- ${known?.name ?? slug} (\`${slug}\`): ${actionList}`);
      if (slug === "github") {
        const working = await getGithubWorkingRepo(workspaceId, userId);
        if (working) {
          lines.push(
            `  Working checkout: \`${working.repo}\` @ \`${working.branch}\` lives in the sandbox under \`repo/\`. Read with fs.read, edit with fs.write (commits back after approval).`,
          );
        } else {
          lines.push(
            "  Linked. If the prompt names a repository, work on that checkout under `repo/`. Otherwise use connector.call and pick the repo the job needs.",
          );
        }
      }
    }
  }
  const next = upsertConnectedToolsSection(content, lines.join("\n"));
  await persistContextFile(workspaceId, next, userId);
  return next;
}
