import { and, asc, desc, eq, gt, gte, inArray, ne, sql } from "drizzle-orm";
import { cache } from "react";
import type { RunEvent, RunEventPayload } from "@agent-os/core";
import { getSessionUser } from "./auth";
import { ensureBootstrapped } from "./bootstrap";
import { getDb } from "@/lib/db/client";
import { env, supabaseAuthEnabled } from "./env";
import { ensureAccountWorkspace } from "./account-workspace";
import { visibleTemplates } from "./template-visibility";
import { spendSince } from "./observability";
import {
  agents,
  approvals,
  budgetPolicies,
  connectors,
  credentials,
  evalRuns,
  evalSuites,
  promptBlocks,
  runEvents,
  runs,
  securityFindings,
  taskLog,
  templateProposals,
  templates,
  users,
  workspaces,
  type AgentRow,
  type RunEventRow,
  type RunRow,
} from "@/lib/db/schema";

export const DEFAULT_WORKSPACE_SLUG = "astronom-platform";

export async function getWorkspace(slug = DEFAULT_WORKSPACE_SLUG) {
  const session = await getSessionUser();
  if (session) return ensureAccountWorkspace(session.id, session.email);
  if (supabaseAuthEnabled() || env.isProduction) throw new Error("Sign in required.");
  const db = await getDb();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  return workspace ?? null;
}

export const requireWorkspace = cache(async (slug = DEFAULT_WORKSPACE_SLUG) => {
  // Pages and layouts render concurrently in the App Router, so a page's
  // first query can run before the layout's bootstrap seed finishes. Gate
  // here (shared, idempotent) so a cold database never 500s the first hit.
  await ensureBootstrapped();
  const workspace = await getWorkspace(slug);
  if (!workspace) {
    throw new Error(
      "Workspace not seeded. Run `pnpm db:seed` (or delete .data/agent-os.db and restart).",
    );
  }
  return workspace;
});

export async function getCurrentUser(workspaceId: string) {
  const db = await getDb();
  const session = await getSessionUser();
  if (session?.email) {
    const [matched] = await db.select().from(users).where(and(eq(users.email, session.email), eq(users.workspaceId, workspaceId))).limit(1);
    if (matched) return matched;
  }
  if (supabaseAuthEnabled()) return null;
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.workspaceId, workspaceId))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return user ?? null;
}

/** The workspace and signed-in user, without the shell stats `getWorkspaceContext` adds. */
export async function getWorkspaceUser() {
  const workspace = await requireWorkspace();
  return { workspace, user: await getCurrentUser(workspace.id) };
}

export async function getWorkspaceContext() {
  const workspace = await requireWorkspace();
  const db = await getDb();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [user, spendRow, pendingRow, cloudSpend] = await Promise.all([
    getCurrentUser(workspace.id),
    db
      .select({ total: sql<number>`coalesce(sum(${runs.costUsd}), 0)` })
      .from(runs)
      .where(
        and(
          eq(runs.workspaceId, workspace.id),
          eq(runs.mode, "live"),
          gte(runs.startedAt, startOfDay),
        ),
      ),
    db
      .select({ total: sql<number>`count(*)` })
      .from(approvals)
      .where(
        and(eq(approvals.workspaceId, workspace.id), eq(approvals.status, "pending")),
      ),
    spendSince(workspace.id, startOfDay),
  ]);

  return {
    workspace,
    user: user ?? null,
    spendTodayUsd: cloudSpend ?? Number(spendRow[0]?.total ?? 0),
    pendingApprovals: Number(pendingRow[0]?.total ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Agents                                                                     */
/* -------------------------------------------------------------------------- */

export async function listAgents(workspaceId: string): Promise<AgentRow[]> {
  return (await getDb())
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId))
    .orderBy(asc(agents.role), asc(agents.createdAt));
}

export async function getAgent(agentId: string): Promise<AgentRow | null> {
  const workspace = await requireWorkspace();
  const [row] = await (await getDb()).select().from(agents).where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspace.id))).limit(1);
  return row ?? null;
}

export async function getAgentDetail(agentId: string) {
  const db = await getDb();
  const agent = await getAgent(agentId);
  if (!agent) return null;

  const [parent, children, blocks, proposals] = await Promise.all([
    agent.parentAgentId ? getAgent(agent.parentAgentId) : Promise.resolve(null),
    db.select().from(agents).where(and(eq(agents.parentAgentId, agent.id), eq(agents.workspaceId, agent.workspaceId))),
    db.select().from(promptBlocks).where(eq(promptBlocks.workspaceId, agent.workspaceId)),
    db
      .select()
      .from(templateProposals)
      .where(eq(templateProposals.parentAgentId, agent.id))
      .orderBy(desc(templateProposals.createdAt)),
  ]);

  return { agent, parent, children, blocks, proposals };
}

/* -------------------------------------------------------------------------- */
/* Runs                                                                       */
/* -------------------------------------------------------------------------- */

export interface RunListRow extends RunRow {
  agentName: string;
  agentRole: string;
}

export async function listRuns(
  workspaceId: string,
  opts?: {
    limit?: number;
    agentId?: string;
    /** Leave out retests and security-check runs, which carry synthetic test data. */
    excludeTests?: boolean;
  },
): Promise<RunListRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      run: runs,
      agentName: agents.name,
      agentRole: agents.role,
    })
    .from(runs)
    .leftJoin(agents, and(eq(agents.id, runs.agentId), eq(agents.workspaceId, runs.workspaceId)))
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
        opts?.agentId ? eq(runs.agentId, opts.agentId) : undefined,
        opts?.excludeTests ? ne(runs.purpose, "retest") : undefined,
      ),
    )
    .orderBy(desc(runs.startedAt))
    .limit(opts?.limit ?? 50);

  return rows.map((row) => ({
    ...row.run,
    agentName: row.agentName ?? "unknown",
    agentRole: row.agentRole ?? "worker",
  }));
}

export async function getRun(runId: string) {
  const workspace = await requireWorkspace();
  const db = await getDb();
  const [row] = await db
    .select({ run: runs, agent: agents })
    .from(runs)
    .leftJoin(agents, and(eq(agents.id, runs.agentId), eq(agents.workspaceId, runs.workspaceId)))
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, workspace.id)))
    .limit(1);
  return row ? { ...row.run, agent: row.agent ?? null } : null;
}

function toRunEvent(row: RunEventRow): RunEvent {
  return {
    id: row.id,
    runId: row.runId,
    seq: row.seq,
    ts: row.ts.toISOString(),
    protocol: 1,
    payload: row.payload as RunEventPayload,
    hash: row.hash,
    prevHash: row.prevHash,
  };
}

/** A run's events in order; `afterSeq` skips the ones a client already has. */
export async function getRunEvents(runId: string, afterSeq?: number): Promise<RunEvent[]> {
  const rows = await (await getDb())
    .select()
    .from(runEvents)
    .where(
      and(
        eq(runEvents.runId, runId),
        afterSeq === undefined ? undefined : gt(runEvents.seq, afterSeq),
      ),
    )
    .orderBy(asc(runEvents.seq));
  return rows.map(toRunEvent);
}

export async function getRunApprovals(runId: string) {
  return (await getDb())
    .select()
    .from(approvals)
    .where(eq(approvals.runId, runId))
    .orderBy(asc(approvals.requestedAt));
}

/* -------------------------------------------------------------------------- */
/* Workspace-level feeds                                                      */
/* -------------------------------------------------------------------------- */

export async function listPendingApprovals(workspaceId: string, limit = 20) {
  return (await getDb())
    .select()
    .from(approvals)
    .where(and(eq(approvals.workspaceId, workspaceId), eq(approvals.status, "pending")))
    .orderBy(asc(approvals.requestedAt))
    .limit(limit);
}

export async function listTaskLog(workspaceId: string, limit = 12) {
  return (await getDb())
    .select()
    .from(taskLog)
    .where(eq(taskLog.workspaceId, workspaceId))
    .orderBy(desc(taskLog.createdAt))
    .limit(limit);
}

export async function listFindings(workspaceId: string, limit = 50) {
  return (await getDb())
    .select()
    .from(securityFindings)
    .where(eq(securityFindings.workspaceId, workspaceId))
    .orderBy(desc(securityFindings.createdAt))
    .limit(limit);
}

export async function listEvalSuites(workspaceId: string) {
  const db = await getDb();
  const suites = await db
    .select()
    .from(evalSuites)
    .where(eq(evalSuites.workspaceId, workspaceId));
  if (suites.length === 0) return [];

  const suiteIds = suites.map((s) => s.id);
  const evalRows = await db
    .select()
    .from(evalRuns)
    .where(inArray(evalRuns.suiteId, suiteIds))
    .orderBy(desc(evalRuns.startedAt));

  return suites.map((suite) => ({
    suite,
    history: evalRows.filter((r) => r.suiteId === suite.id),
  }));
}

export async function listConnectors(workspaceId: string, accountId: string) {
  const db = await getDb();
  const [connectorRows, credentialRows] = await Promise.all([
    db.select().from(connectors).where(eq(connectors.workspaceId, workspaceId)),
    db
      .select({
        id: credentials.id,
        name: credentials.name,
        connectorId: credentials.connectorId,
        hint: credentials.hint,
        scopes: credentials.scopes,
        createdBy: credentials.createdBy,
        lastUsedAt: credentials.lastUsedAt,
        rotatedAt: credentials.rotatedAt,
        createdAt: credentials.createdAt,
      })
      .from(credentials)
      .where(and(eq(credentials.workspaceId, workspaceId), eq(credentials.createdBy, accountId))),
  ]);
  return { connectors: connectorRows, credentials: credentialRows };
}

export async function listTemplates() {
  const workspace = await requireWorkspace();
  return (await getDb()).select().from(templates).where(visibleTemplates(workspace.id)).orderBy(asc(templates.name));
}

export async function listBudgetPolicies(workspaceId: string) {
  return (await getDb())
    .select()
    .from(budgetPolicies)
    .where(eq(budgetPolicies.workspaceId, workspaceId));
}
