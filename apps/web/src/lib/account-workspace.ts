import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, getTableColumns, inArray, isTable, or, sql, type AnyColumn } from "drizzle-orm";
import { getDb } from "./db/client";
import * as schema from "./db/schema";
import { env } from "./env";

export function accountWorkspaceId(accountId: string) {
  return `ws_account_${createHash("sha256").update(accountId).digest("hex").slice(0, 24)}`;
}

/** Call only with an identity returned by verified server auth. No client-supplied tenant IDs. */
export async function ensureAccountWorkspace(accountId: string, email: string) {
  const db = await getDb();
  const id = accountWorkspaceId(accountId);
  const [existing] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
    const [concurrent] = await tx.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1);
    if (concurrent) return concurrent;
    const [base] = await tx.select().from(schema.workspaces).where(eq(schema.workspaces.id, "ws_astronom")).limit(1);
    const [workspace] = await tx.insert(schema.workspaces).values({ id, slug: id, name: "Astronom", deniedModelIds: base?.deniedModelIds ?? [], defaultDataClass: base?.defaultDataClass ?? "internal", createdAt: new Date() }).returning();
    if (!workspace) throw new Error("Could not create your private workspace.");
    const blocks = await tx.select().from(schema.promptBlocks).where(and(eq(schema.promptBlocks.workspaceId, "ws_astronom"), eq(schema.promptBlocks.locked, true)));
    const blockIds = new Map(blocks.map((block) => [block.id, `${id}_${block.id}`]));
    if (blocks.length) await tx.insert(schema.promptBlocks).values(blocks.map((block) => ({ ...block, id: blockIds.get(block.id)!, workspaceId: id })));
    const platform = await tx.select().from(schema.agents).where(inArray(schema.agents.id, ["agt_red_team", "agt_blue_team"]));
    if (platform.length) await tx.insert(schema.agents).values(platform.map((agent) => ({ ...agent, id: `${agent.id}_${id}`, workspaceId: id, parentAgentId: null,
      inheritedPromptBlockIds: agent.inheritedPromptBlockIds.flatMap((key) => blockIds.has(key) ? [blockIds.get(key)!] : []), status: "active" as const })));
    await tx.insert(schema.budgetPolicies).values({ id: `bp_${id}`, workspaceId: id, agentId: null, period: "day", limitUsd: 40, warnAt: 0.75, hardStop: true, createdAt: new Date() });

    // Recover only records with a verified creator. Never give an account the whole old workspace.
    const audits = await tx.select().from(schema.auditLog).where(and(eq(schema.auditLog.workspaceId, "ws_astronom"), eq(schema.auditLog.actor, email)));
    const creations = audits.filter((row) => row.targetType === "agent" && ["agent.created", "agent.created_from_template", "agent.created_from_use_case", "workflow.created"].includes(row.action));
    const owned = new Set(creations.flatMap((row) => [row.targetId, ...(Array.isArray(row.detail?.createdAgents) && row.detail.createdAgents.includes(row.targetId) ? row.detail.createdAgents.filter((value): value is string => typeof value === "string") : [])]));
    owned.delete("agt_red_team"); owned.delete("agt_blue_team");
    const legacy = await tx.select().from(schema.agents).where(eq(schema.agents.workspaceId, "ws_astronom"));
    for (let changed = true; changed;) {
      changed = false;
      for (const agent of legacy) if (agent.parentAgentId && owned.has(agent.parentAgentId) && !owned.has(agent.id)) { owned.add(agent.id); changed = true; }
    }
    const ownedIds = [...owned].filter((key) => legacy.some((agent) => agent.id === key));
    const extraIds = [...new Set(legacy.filter((agent) => ownedIds.includes(agent.id)).flatMap((agent) => agent.inheritedPromptBlockIds).filter((key) => !blockIds.has(key)))];
    if (extraIds.length) {
      const extra = await tx.select().from(schema.promptBlocks).where(and(eq(schema.promptBlocks.workspaceId, "ws_astronom"), inArray(schema.promptBlocks.id, extraIds)));
      for (const block of extra) blockIds.set(block.id, `${id}_${block.id}`);
      if (extra.length) await tx.insert(schema.promptBlocks).values(extra.map((block) => ({ ...block, id: blockIds.get(block.id)!, workspaceId: id })));
    }
    const oldRuns = await tx.select({ id: schema.runs.id }).from(schema.runs).where(and(eq(schema.runs.workspaceId, "ws_astronom"),
      ownedIds.length ? inArray(schema.runs.agentId, ownedIds) : sql`false`, or(eq(schema.runs.operatorUserId, accountId), sql`${schema.runs.operatorUserId} is null`)));
    const runIds = oldRuns.map((run) => run.id);
    for (const key of ownedIds) {
      if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error("Invalid legacy agent identity.");
      const source = path.join(env.sandboxRoot, "ws_astronom", key);
      const destination = path.join(env.sandboxRoot, id, key);
      if (fs.existsSync(source)) { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.cpSync(source, destination, { recursive: true, force: false }); }
    }
    // All app tables remain private. Related rows keep their IDs and foreign keys.
    for (const table of Object.values(schema)) {
      if (!isTable(table)) continue;
      const columns: Record<string, AnyColumn> = getTableColumns(table);
      if (!columns.workspaceId || table === schema.workspaces || table === schema.users) continue;
      const matches = [];
      const agentMatches = [];
      if (ownedIds.length) for (const key of ["agentId", "parentAgentId", "targetAgentId"] as const) if (columns[key]) agentMatches.push(inArray(columns[key], ownedIds));
      const runColumn = columns.runId ?? columns.sourceRunId;
      // A legacy run from another operator must not bring approval rights across accounts.
      if (runColumn) {
        if (runIds.length) matches.push(and(inArray(runColumn, runIds), agentMatches.length ? or(...agentMatches) : sql`true`)!);
        if (agentMatches.length) matches.push(and(sql`${runColumn} is null`, or(...agentMatches))!);
      } else if (table !== schema.runs) matches.push(...agentMatches);
      if (table === schema.agents && ownedIds.length) matches.push(inArray(columns.id!, ownedIds));
      if (table === schema.runs && runIds.length) matches.push(inArray(columns.id!, runIds));
      if (table === schema.auditLog) matches.push(eq(columns.actor!, email));
      if (table === schema.credentials) matches.push(eq(columns.createdBy!, accountId));
      if (table === schema.kbDocuments) matches.push(or(eq(columns.addedBy!, accountId), eq(columns.addedBy!, email))!);
      if (table === schema.connectedAccounts) matches.push(eq(columns.userId!, accountId));
      if (matches.length) await tx.execute(sql`update ${table} set ${sql.identifier("workspace_id")} = ${id} where ${columns.workspaceId} = ${"ws_astronom"} and (${or(...matches)})`);
    }
    // Remap inherited platform policies and workflow sources to private copies.
    for (const agent of legacy.filter((row) => ownedIds.includes(row.id))) await tx.update(schema.agents).set({
      inheritedPromptBlockIds: agent.inheritedPromptBlockIds.map((key) => blockIds.get(key) ?? key),
      sourceAgentId: agent.sourceAgentId && ["agt_red_team", "agt_blue_team"].includes(agent.sourceAgentId) ? `${agent.sourceAgentId}_${id}` : agent.sourceAgentId,
    }).where(and(eq(schema.agents.id, agent.id), eq(schema.agents.workspaceId, id)));
    await tx.update(schema.users).set({ workspaceId: id }).where(eq(schema.users.email, email));
    return workspace;
  });
}
