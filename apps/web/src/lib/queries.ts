import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { RunEvent, RunEventPayload } from "@agent-os/core";
import { getSessionUser } from "./auth";
import { ensureBootstrapped } from "./bootstrap";
import { getDb } from "@/lib/db/client";
import { supabaseAuthEnabled } from "./env";
import { spendSince } from "./observability";
import {
  agents,
  approvals,
  auditLog,
  budgetPolicies,
  connectors,
  credentials,
  evalRuns,
  evalSuites,
  memories,
  promptBlocks,
  runEvents,
  runs,
  securityFindings,
  taskLog,
  templateProposals,
  templates,
  triggers,
  users,
  workspaces,
  type AgentRow,
  type RunEventRow,
  type RunRow,
} from "@/lib/db/schema";

export const DEFAULT_WORKSPACE_SLUG = "astronom-platform";

export async function getWorkspace(slug = DEFAULT_WORKSPACE_SLUG) {
  const db = getDb();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  return workspace ?? null;
}

export async function requireWorkspace(slug = DEFAULT_WORKSPACE_SLUG) {
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
}

export async function getCurrentUser(workspaceId: string) {
  const db = getDb();
  const session = await getSessionUser();
  if (session?.email) {
    const [matched] = await db.select().from(users).where(eq(users.email, session.email)).limit(1);
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

export async function getWorkspaceContext() {
  const workspace = await requireWorkspace();
  const db = getDb();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [user, spendRow, pendingRow, agentRows, cloudSpend] = await Promise.all([
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
    db.select().from(agents).where(eq(agents.workspaceId, workspace.id)),
    spendSince(workspace.id, startOfDay),
  ]);

  return {
    workspace,
    user: user ?? null,
    spendTodayUsd: cloudSpend ?? Number(spendRow[0]?.total ?? 0),
    pendingApprovals: Number(pendingRow[0]?.total ?? 0),
    agentCount: agentRows.length,
    activeAgentCount: agentRows.filter((a) => a.status === "active").length,
  };
}

/* -------------------------------------------------------------------------- */
/* Agents                                                                     */
/* -------------------------------------------------------------------------- */

export async function listAgents(workspaceId: string): Promise<AgentRow[]> {
  return getDb()
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId))
    .orderBy(asc(agents.role), asc(agents.createdAt));
}

export async function getAgent(agentId: string): Promise<AgentRow | null> {
  const [row] = await getDb().select().from(agents).where(eq(agents.id, agentId)).limit(1);
  return row ?? null;
}

export async function getAgentDetail(agentId: string) {
  const db = getDb();
  const agent = await getAgent(agentId);
  if (!agent) return null;

  const [parent, children, blocks, agentRuns, suites, findings, agentTriggers, agentBudget, proposals] =
    await Promise.all([
      agent.parentAgentId ? getAgent(agent.parentAgentId) : Promise.resolve(null),
      db.select().from(agents).where(eq(agents.parentAgentId, agent.id)),
      db.select().from(promptBlocks).where(eq(promptBlocks.workspaceId, agent.workspaceId)),
      db
        .select()
        .from(runs)
        .where(eq(runs.agentId, agent.id))
        .orderBy(desc(runs.startedAt))
        .limit(10),
      db.select().from(evalSuites).where(eq(evalSuites.agentId, agent.id)),
      db
        .select()
        .from(securityFindings)
        .where(eq(securityFindings.targetAgentId, agent.id))
        .orderBy(desc(securityFindings.createdAt)),
      db.select().from(triggers).where(eq(triggers.agentId, agent.id)),
      db
        .select()
        .from(budgetPolicies)
        .where(eq(budgetPolicies.agentId, agent.id))
        .limit(1),
      db
        .select()
        .from(templateProposals)
        .where(eq(templateProposals.parentAgentId, agent.id))
        .orderBy(desc(templateProposals.createdAt)),
    ]);

  return {
    agent,
    parent,
    children,
    blocks,
    runs: agentRuns,
    suites,
    findings,
    triggers: agentTriggers,
    budget: agentBudget[0] ?? null,
    proposals,
  };
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
  opts?: { limit?: number; agentId?: string },
): Promise<RunListRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      run: runs,
      agentName: agents.name,
      agentRole: agents.role,
    })
    .from(runs)
    .leftJoin(agents, eq(agents.id, runs.agentId))
    .where(
      opts?.agentId
        ? and(eq(runs.workspaceId, workspaceId), eq(runs.agentId, opts.agentId))
        : eq(runs.workspaceId, workspaceId),
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
  const db = getDb();
  const [row] = await db
    .select({ run: runs, agent: agents })
    .from(runs)
    .leftJoin(agents, eq(agents.id, runs.agentId))
    .where(eq(runs.id, runId))
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

export async function getRunEvents(runId: string): Promise<RunEvent[]> {
  const rows = await getDb()
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.seq));
  return rows.map(toRunEvent);
}

export async function getRunEventBodies(runId: string): Promise<RunEventRow[]> {
  return getDb()
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.seq));
}

export async function getRunApprovals(runId: string) {
  return getDb()
    .select()
    .from(approvals)
    .where(eq(approvals.runId, runId))
    .orderBy(asc(approvals.requestedAt));
}

export async function getRunFindings(runId: string) {
  return getDb()
    .select()
    .from(securityFindings)
    .where(eq(securityFindings.runId, runId))
    .orderBy(desc(securityFindings.severity));
}

/* -------------------------------------------------------------------------- */
/* Workspace-level feeds                                                      */
/* -------------------------------------------------------------------------- */

export async function listPendingApprovals(workspaceId: string, limit = 20) {
  return getDb()
    .select()
    .from(approvals)
    .where(and(eq(approvals.workspaceId, workspaceId), eq(approvals.status, "pending")))
    .orderBy(asc(approvals.requestedAt))
    .limit(limit);
}

export async function listApprovals(workspaceId: string, limit = 50) {
  return getDb()
    .select()
    .from(approvals)
    .where(eq(approvals.workspaceId, workspaceId))
    .orderBy(desc(approvals.requestedAt))
    .limit(limit);
}

export async function listTaskLog(workspaceId: string, limit = 12) {
  return getDb()
    .select()
    .from(taskLog)
    .where(eq(taskLog.workspaceId, workspaceId))
    .orderBy(desc(taskLog.createdAt))
    .limit(limit);
}

export async function listMemories(
  workspaceId: string,
  opts?: { agentId?: string; limit?: number },
) {
  const db = getDb();
  const where = opts?.agentId
    ? and(eq(memories.workspaceId, workspaceId), eq(memories.agentId, opts.agentId))
    : eq(memories.workspaceId, workspaceId);
  return db
    .select()
    .from(memories)
    .where(where)
    .orderBy(desc(memories.importance), desc(memories.createdAt))
    .limit(opts?.limit ?? 20);
}

export async function listFindings(workspaceId: string, limit = 50) {
  return getDb()
    .select()
    .from(securityFindings)
    .where(eq(securityFindings.workspaceId, workspaceId))
    .orderBy(desc(securityFindings.createdAt))
    .limit(limit);
}

export async function getSecuritySummary(workspaceId: string) {
  const db = getDb();
  const rows = await db
    .select({
      severity: securityFindings.severity,
      count: sql<number>`count(*)`,
    })
    .from(securityFindings)
    .where(eq(securityFindings.workspaceId, workspaceId))
    .groupBy(securityFindings.severity);

  const bySeverity: Record<string, number> = {};
  for (const row of rows) bySeverity[row.severity] = Number(row.count);

  const [openRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(securityFindings)
    .where(
      and(
        eq(securityFindings.workspaceId, workspaceId),
        eq(securityFindings.status, "open"),
      ),
    );

  return {
    bySeverity,
    open: Number(openRow?.total ?? 0),
    total: Object.values(bySeverity).reduce((a, b) => a + b, 0),
  };
}

export async function listEvalSuites(workspaceId: string) {
  const db = getDb();
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

export async function listConnectors(workspaceId: string) {
  const db = getDb();
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
      .where(eq(credentials.workspaceId, workspaceId)),
  ]);
  return { connectors: connectorRows, credentials: credentialRows };
}

export async function listTemplates() {
  return getDb().select().from(templates).orderBy(asc(templates.name));
}

export async function listPromptBlocks(workspaceId: string) {
  return getDb()
    .select()
    .from(promptBlocks)
    .where(eq(promptBlocks.workspaceId, workspaceId))
    .orderBy(asc(promptBlocks.level), asc(promptBlocks.name));
}

export async function listTriggers(workspaceId: string) {
  return getDb()
    .select()
    .from(triggers)
    .where(eq(triggers.workspaceId, workspaceId))
    .orderBy(asc(triggers.kind));
}

export async function listBudgetPolicies(workspaceId: string) {
  return getDb()
    .select()
    .from(budgetPolicies)
    .where(eq(budgetPolicies.workspaceId, workspaceId));
}

export async function listAuditLog(workspaceId: string, limit = 40) {
  return getDb()
    .select()
    .from(auditLog)
    .where(eq(auditLog.workspaceId, workspaceId))
    .orderBy(desc(auditLog.at))
    .limit(limit);
}

export async function getWorkspaceStats(workspaceId: string) {
  const db = getDb();
  const [runStats] = await db
    .select({
      total: sql<number>`count(*)`,
      succeeded: sql<number>`sum(case when ${runs.status} = 'succeeded' then 1 else 0 end)`,
      cost: sql<number>`coalesce(sum(${runs.costUsd}), 0)`,
      tokens: sql<number>`coalesce(sum(${runs.inputTokens} + ${runs.outputTokens}), 0)`,
    })
    .from(runs)
    .where(eq(runs.workspaceId, workspaceId));

  return {
    totalRuns: Number(runStats?.total ?? 0),
    succeededRuns: Number(runStats?.succeeded ?? 0),
    totalCostUsd: Number(runStats?.cost ?? 0),
    totalTokens: Number(runStats?.tokens ?? 0),
    successRate:
      Number(runStats?.total ?? 0) > 0
        ? Number(runStats?.succeeded ?? 0) / Number(runStats?.total ?? 1)
        : 0,
  };
}
