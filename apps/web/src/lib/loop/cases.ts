/**
 * The red-team feedback loop. Plain-language overview: lib/loop/README.md.
 *
 * Every write here leaves an audit entry. Nothing in this module lets an agent
 * change another agent: a fix lands only through applyFix(), which requires an
 * approval a person gave for that exact proposal.
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  agents,
  agentVersions,
  auditLog,
  findingCases,
  promptBlocks,
  runEvents,
  runs,
  securityFindings,
  users,
  type AgentRow,
  type CaseChange,
  type CaseHop,
  type CaseMessage,
  type CaseProbe,
  type CaseProposal,
  type CaseRetest,
  type FindingCaseRow,
  type SecurityFindingRow,
} from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { redactSecrets } from "@/lib/secrets";
import { lineDiff, proposalHash } from "./diff";
import {
  afterRetestFailure,
  assertTransition,
  DEFAULT_LOOP_BUDGET_USD,
  DEFAULT_MAX_ROUNDS,
  DEFAULT_RETEST_RUN_BUDGET_USD,
  roundFitsBudget,
  type FindingStatus,
} from "./lifecycle";
import {
  authoredText,
  buildProbe,
  judgeRetest,
  reproductionSteps,
  syntheticBatch,
  STALL_MS,
  type EventLike,
  type RetestEvidence,
} from "./probes";

/* ---------- Actors ---------- */

/** A person acts by email. Agents act by id. Only people may approve. */
export type Actor = { kind: "person"; name: string } | { kind: "agent"; agentId: string };

const person = (name: string): Actor => ({ kind: "person", name });
export { person };

function actorName(actor: Actor): string {
  return actor.kind === "person" ? actor.name : `agent:${actor.agentId}`;
}

/* ---------- Plumbing ---------- */

async function audit(
  workspaceId: string,
  actor: string,
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown>,
) {
  await getDb().insert(auditLog).values({
    id: newId("aud"),
    workspaceId,
    actor,
    action,
    targetType,
    targetId,
    detail,
    at: new Date(),
  });
}

async function loadFinding(findingId: string): Promise<SecurityFindingRow> {
  const [row] = await getDb().select().from(securityFindings).where(eq(securityFindings.id, findingId)).limit(1);
  if (!row) throw new Error("Finding not found.");
  return row;
}

export async function loadCase(caseId: string): Promise<FindingCaseRow> {
  const [row] = await getDb().select().from(findingCases).where(eq(findingCases.id, caseId)).limit(1);
  if (!row) throw new Error("Case not found.");
  return row;
}

async function loadAgent(agentId: string): Promise<AgentRow> {
  const [row] = await getDb().select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!row) throw new Error("Agent not found.");
  return row;
}

/** The only way a finding's status changes inside the loop. */
async function moveFinding(
  finding: SecurityFindingRow,
  to: FindingStatus,
  actor: string,
  detail: Record<string, unknown> = {},
) {
  assertTransition(finding.status, to);
  await getDb().update(securityFindings).set({ status: to }).where(eq(securityFindings.id, finding.id));
  await audit(finding.workspaceId, actor, "finding.status_changed", "security_finding", finding.id, {
    from: finding.status,
    to,
    ...detail,
  });
  finding.status = to;
}

async function updateCase(id: string, patch: Partial<FindingCaseRow>) {
  await getDb()
    .update(findingCases)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(findingCases.id, id));
}

function say(from: CaseMessage["from"], text: string, proposalHash?: string): CaseMessage {
  return { from, text: redactSecrets(text), at: new Date().toISOString(), ...(proposalHash ? { proposalHash } : {}) };
}

function caseOpen(row: FindingCaseRow) {
  if (row.state === "closed") throw new Error("This case is closed.");
  if (row.state === "escalated") throw new Error("This case is waiting on a person after escalation.");
}

/**
 * Runs do not record who started them; the workspace's first user is the
 * person this app treats as the operator everywhere else.
 */
async function workspacePerson(workspaceId: string): Promise<string> {
  const [user] = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.workspaceId, workspaceId))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return user?.email ?? "operator@local";
}

/* ---------- 1. Accept ---------- */

/**
 * Accepting is done by a person, or by the red-team lead that owns the probe
 * (the reporting security agent or its security parent).
 */
export async function acceptFinding(findingId: string, actor: Actor): Promise<SecurityFindingRow> {
  const finding = await loadFinding(findingId);
  if (actor.kind === "agent") {
    const lead = await loadAgent(actor.agentId);
    const reporter = await loadAgent(finding.agentId);
    const owns = lead.id === reporter.id || lead.id === reporter.parentAgentId;
    if (lead.role !== "security" || !owns) {
      throw new Error("Only a person or the red-team lead that ran the probe may accept a finding.");
    }
  }
  if (finding.status === "open") await moveFinding(finding, "accepted", actorName(actor));
  return finding;
}

/* ---------- 2. Open and elevate ---------- */

export interface LevelReview {
  /** Extra context this level adds. It can never remove what is there. */
  note?: string;
  /** The level declines to act. The case still moves up. */
  decline?: boolean;
}
export type LevelReviewer = (agent: AgentRow, row: FindingCaseRow) => LevelReview | Promise<LevelReview>;

/** Default review for a chain-of-command level. Deterministic, no model calls. */
export const defaultReviewer: LevelReviewer = (agent, row) => {
  if (agent.id === row.targetAgentId) {
    return { decline: true, note: `${agent.name} is the agent under test, so it passes the case up without acting on it.` };
  }
  if (agent.role === "security") {
    return { note: `${agent.name} confirmed the finding and passed it up.` };
  }
  return { note: `${agent.name} passed the case up the chain.` };
};

export async function openCase(
  findingId: string,
  actor: Actor,
  options: { budgetCapUsd?: number; maxRounds?: number } = {},
): Promise<FindingCaseRow> {
  const db = getDb();
  const finding = await acceptFinding(findingId, actor);
  const [existing] = await db.select().from(findingCases).where(eq(findingCases.findingId, findingId)).limit(1);
  if (existing) return existing;
  if (finding.status !== "accepted") {
    throw new Error("Only an accepted finding can start a case.");
  }
  const targetId = finding.targetAgentId;
  if (!targetId) throw new Error("This finding has no target agent.");
  const target = await loadAgent(targetId);
  const [run] = await db.select().from(runs).where(eq(runs.id, finding.runId)).limit(1);
  const runGoal = redactSecrets(run?.goal ?? "Unknown goal");
  const targetTask = target.defaultGoal || target.summary || target.name;

  const probe: CaseProbe = buildProbe(
    { category: finding.category, targetTask, observed: finding.detail },
    "reproduction",
    finding.id,
  );
  const now = new Date();
  const row: FindingCaseRow = {
    id: newId("case"),
    workspaceId: finding.workspaceId,
    findingId: finding.id,
    targetAgentId: target.id,
    sourceRunId: finding.runId,
    runGoal,
    severity: finding.severity,
    observed: redactSecrets(`${finding.title}. ${finding.detail}${finding.evidence ? ` Evidence: ${finding.evidence}` : ""}`),
    proposedRemediation: redactSecrets(finding.remediation ?? ""),
    reproduction: {
      steps: reproductionSteps({
        category: finding.category,
        targetTask,
        runGoal,
        evidence: finding.evidence ? redactSecrets(finding.evidence) : null,
      }),
      probe,
    },
    hops: [],
    deliveredTo: null,
    conversation: [],
    proposal: null,
    approval: null,
    state: "open",
    escalationReason: null,
    round: 0,
    maxRounds: options.maxRounds ?? DEFAULT_MAX_ROUNDS,
    budgetCapUsd: options.budgetCapUsd ?? DEFAULT_LOOP_BUDGET_USD,
    spentUsd: 0,
    appliedVersion: null,
    latestRetestRunId: null,
    retests: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(findingCases).values(row);
  await audit(row.workspaceId, actorName(actor), "case.opened", "finding_case", row.id, {
    findingId: finding.id,
    targetAgentId: target.id,
    severity: finding.severity,
  });
  return row;
}

/**
 * Walk the case up parentAgentId one level at a time, from the agent that
 * reported it to the top of its chain. Each level may add context or decline,
 * but the walk never stops early, so no level can drop the case. At the top it
 * is delivered to the target's creator conversation and to a person.
 */
export async function elevateCase(
  caseId: string,
  deliverTo?: string,
  reviewer: LevelReviewer = defaultReviewer,
): Promise<FindingCaseRow> {
  const row = await loadCase(caseId);
  const personName = deliverTo ?? (await workspacePerson(row.workspaceId));
  caseOpen(row);
  if (row.deliveredTo) return row;
  const finding = await loadFinding(row.findingId);
  const target = await loadAgent(row.targetAgentId);
  const hops: CaseHop[] = [...row.hops];
  const seen = new Set<string>();
  let current: AgentRow | null = await loadAgent(finding.agentId);
  let first = true;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (first) {
      hops.push({
        agentId: current.id,
        agentName: current.name,
        action: "reported",
        note: `${current.name} recorded the finding and opened the case.`,
        at: new Date().toISOString(),
      });
      first = false;
    } else {
      const review = await reviewer(current, row);
      const action: CaseHop["action"] = review.decline ? "declined_to_act" : review.note ? "added_context" : "forwarded";
      hops.push({
        agentId: current.id,
        agentName: current.name,
        action,
        note: redactSecrets(review.note ?? `${current.name} passed the case up.`),
        at: new Date().toISOString(),
      });
    }
    await audit(row.workspaceId, `agent:${current.id}`, "case.elevated", "finding_case", row.id, {
      level: hops.length,
      agentId: current.id,
      action: hops[hops.length - 1]!.action,
    });
    current = current.parentAgentId ? await loadAgent(current.parentAgentId) : null;
  }

  const deliveredTo = {
    creator: `Agent creator for ${target.name}`,
    person: personName,
    at: new Date().toISOString(),
  };
  const conversation = [...row.conversation, say("platform", caseBrief(row, target.name, finding))];
  await updateCase(row.id, { hops, deliveredTo, conversation });
  await audit(row.workspaceId, "platform", "case.delivered", "finding_case", row.id, deliveredTo);
  return loadCase(row.id);
}

/** The case in plain language, as the creator and the person first see it. */
export function caseBrief(row: FindingCaseRow, targetName: string, finding: Pick<SecurityFindingRow, "title">): string {
  return [
    `The red team found a ${row.severity}-severity problem in ${targetName}: ${finding.title}.`,
    `It happened during a run with the goal "${row.runGoal}".`,
    `What it saw: ${row.observed}`,
    row.proposedRemediation ? `The red team suggests: ${row.proposedRemediation}` : "",
    "Propose the smallest change to this agent that stops it. Nothing changes until a person approves it here.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ---------- 3. Propose ---------- */

interface Applied {
  instructions: string;
  allowedTools: string[];
  grants: AgentRow["grants"];
  rule: string | null;
}

/** What the target would look like after the change. Never widens access. */
function applyChange(target: AgentRow, change: CaseChange): Applied {
  const base: Applied = {
    instructions: target.instructions,
    allowedTools: target.allowedTools,
    grants: target.grants,
    rule: null,
  };
  if (change.kind === "instructions") {
    const text = change.instructions.trim();
    if (text.length < 20) throw new Error("The new instructions are too short.");
    return { ...base, instructions: text };
  }
  if (change.kind === "narrow_tools") {
    const remove = new Set(change.removeTools);
    if (remove.size === 0) throw new Error("Name at least one tool to remove.");
    for (const tool of remove) {
      if (!target.allowedTools.includes(tool)) throw new Error(`${target.name} does not have ${tool}, so it cannot be removed.`);
    }
    return {
      ...base,
      allowedTools: target.allowedTools.filter((t) => !remove.has(t)),
      grants: target.grants.filter((g) => !remove.has(g.resource)),
    };
  }
  const rule = change.rule.trim();
  if (rule.length < 20) throw new Error("The rule is too short.");
  return { ...base, rule };
}

function describe(target: AgentRow, change: CaseChange, after: Applied): { diff: string; summary: string } {
  if (change.kind === "instructions") {
    return { diff: lineDiff(target.instructions, after.instructions), summary: `Update ${target.name}'s instructions.` };
  }
  if (change.kind === "narrow_tools") {
    return {
      diff: lineDiff(target.allowedTools.join("\n"), after.allowedTools.join("\n")),
      summary: `Remove ${change.removeTools.join(", ")} from ${target.name}.`,
    };
  }
  return {
    diff: lineDiff("", `Locked rule for ${target.name} only:\n${after.rule}`),
    summary: `Add a locked rule that applies to ${target.name} only.`,
  };
}

export async function proposeFix(
  caseId: string,
  input: { change: CaseChange; source: CaseProposal["source"]; reply?: string },
): Promise<FindingCaseRow> {
  const row = await loadCase(caseId);
  caseOpen(row);
  if (!row.deliveredTo) throw new Error("The case has not reached the creator yet.");
  const finding = await loadFinding(row.findingId);
  const target = await loadAgent(row.targetAgentId);
  // Redact before hashing, so the approved hash matches what is stored.
  const change: CaseChange =
    input.change.kind === "instructions"
      ? { kind: "instructions", instructions: redactSecrets(input.change.instructions) }
      : input.change.kind === "scoped_rule"
        ? { kind: "scoped_rule", rule: redactSecrets(input.change.rule) }
        : { kind: "narrow_tools", removeTools: [...new Set(input.change.removeTools)] };
  const after = applyChange(target, change);
  const { diff, summary } = describe(target, change, after);
  const newRound = finding.status === "accepted" || finding.status === "retest_failed";
  const round = newRound ? row.round + 1 : row.round;
  const hash = proposalHash({ caseId: row.id, targetAgentId: target.id, round, baseVersion: target.version, change });
  const proposal: CaseProposal = {
    hash,
    round,
    baseVersion: target.version,
    change,
    diff,
    summary,
    source: input.source,
    at: new Date().toISOString(),
  };
  await moveFinding(finding, "proposed_fix", "agent-creator", { caseId: row.id, round });
  const conversation = [
    ...row.conversation,
    say("creator", input.reply?.trim() || `${summary} Review the change below and approve it if it looks right.`, hash),
  ];
  // A new proposal voids any earlier approval.
  await updateCase(row.id, { proposal, approval: null, round, conversation });
  await audit(row.workspaceId, "agent-creator", "case.fix_proposed", "finding_case", row.id, {
    findingId: row.findingId,
    round,
    kind: change.kind,
    source: input.source,
    proposalHash: hash,
    diff,
  });
  return loadCase(row.id);
}

/** A person's message in the case conversation. */
export async function addPersonMessage(caseId: string, author: string, text: string): Promise<FindingCaseRow> {
  const row = await loadCase(caseId);
  await updateCase(row.id, { conversation: [...row.conversation, say("person", text)] });
  await audit(row.workspaceId, author, "case.message", "finding_case", row.id, { length: text.length });
  return loadCase(row.id);
}

/** A creator reply that carries no proposal. */
export async function addCreatorMessage(caseId: string, text: string): Promise<FindingCaseRow> {
  const row = await loadCase(caseId);
  await updateCase(row.id, { conversation: [...row.conversation, say("creator", text)] });
  return loadCase(row.id);
}

/* ---------- 4. Approve and apply ---------- */

/** Approval covers one proposal, by hash. Only a person can give it. */
export async function approveFix(caseId: string, proposalHashToApprove: string, approver: Actor): Promise<FindingCaseRow> {
  if (approver.kind !== "person" || !approver.name.trim()) {
    throw new Error("Only a person can approve a fix.");
  }
  const row = await loadCase(caseId);
  caseOpen(row);
  if (!row.proposal) throw new Error("There is no proposed change to approve.");
  if (row.proposal.hash !== proposalHashToApprove) {
    throw new Error("That approval is for a different change. Review the current proposal.");
  }
  const finding = await loadFinding(row.findingId);
  await moveFinding(finding, "approved", approver.name, { caseId: row.id, proposalHash: row.proposal.hash });
  const approval = { proposalHash: row.proposal.hash, by: approver.name, at: new Date().toISOString(), used: false };
  const conversation = [...row.conversation, say("person", `Approved: ${row.proposal.summary}`, row.proposal.hash)];
  await updateCase(row.id, { approval, conversation });
  await audit(row.workspaceId, approver.name, "case.fix_approved", "finding_case", row.id, {
    findingId: row.findingId,
    proposalHash: row.proposal.hash,
    round: row.proposal.round,
  });
  return loadCase(row.id);
}

async function snapshot(target: AgentRow, createdBy: string, reason: string) {
  const db = getDb();
  const [has] = await db
    .select({ id: agentVersions.id })
    .from(agentVersions)
    .where(and(eq(agentVersions.agentId, target.id), eq(agentVersions.version, target.version)))
    .limit(1);
  if (has) return;
  await db.insert(agentVersions).values({
    id: newId("agv"),
    workspaceId: target.workspaceId,
    agentId: target.id,
    version: target.version,
    instructions: target.instructions,
    allowedTools: target.allowedTools,
    grants: target.grants,
    inheritedPromptBlockIds: target.inheritedPromptBlockIds,
    createdBy,
    reason,
    createdAt: new Date(),
  });
}

/**
 * The platform applies an approved change as a new version of the target and
 * of nothing else. A scoped rule is a locked agent-level block attached only
 * to the target.
 */
export async function applyFix(caseId: string): Promise<FindingCaseRow> {
  const db = getDb();
  const row = await loadCase(caseId);
  caseOpen(row);
  const { proposal, approval } = row;
  if (!proposal || !approval) throw new Error("This change has not been approved.");
  if (approval.used) throw new Error("That approval was already used. Each approval covers one change.");
  if (approval.proposalHash !== proposal.hash) throw new Error("The approval does not match the current proposal.");
  const finding = await loadFinding(row.findingId);
  if (finding.status !== "approved") throw new Error("This change has not been approved.");
  const target = await loadAgent(row.targetAgentId);
  if (target.version !== proposal.baseVersion) {
    throw new Error("The agent changed since this fix was proposed. Ask for a new proposal.");
  }

  const after = applyChange(target, proposal.change);
  await snapshot(target, "platform", "Version before the fix");

  let blockIds = target.inheritedPromptBlockIds;
  let blockId: string | null = null;
  if (after.rule) {
    blockId = newId("pb");
    await db.insert(promptBlocks).values({
      id: blockId,
      workspaceId: target.workspaceId,
      name: `Fix for ${target.name} (${row.findingId})`,
      level: "agent",
      locked: true,
      version: 1,
      content: after.rule,
      createdAt: new Date(),
    });
    blockIds = [...blockIds, blockId];
  }

  const version = target.version + 1;
  await db
    .update(agents)
    .set({
      instructions: after.instructions,
      allowedTools: after.allowedTools,
      grants: after.grants,
      inheritedPromptBlockIds: blockIds,
      version,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, target.id));
  await snapshot(
    { ...target, instructions: after.instructions, allowedTools: after.allowedTools, grants: after.grants, inheritedPromptBlockIds: blockIds, version },
    approval.by,
    `Fix for finding ${row.findingId}, approved by ${approval.by}`,
  );

  await moveFinding(finding, "applied", "platform", { caseId: row.id, version });
  const conversation = [...row.conversation, say("platform", `Applied as version ${version} of ${target.name}. Retesting next.`)];
  await updateCase(row.id, { approval: { ...approval, used: true }, appliedVersion: version, conversation });
  await audit(row.workspaceId, "platform", "case.fix_applied", "agent", target.id, {
    caseId: row.id,
    findingId: row.findingId,
    approvedBy: approval.by,
    proposalHash: proposal.hash,
    fromVersion: target.version,
    toVersion: version,
    promptBlockId: blockId,
    diff: proposal.diff,
  });
  return loadCase(row.id);
}

/* ---------- 5. Retest ---------- */

/** Starts real runs. The default goes through the run engine; tests inject a fake. */
export interface RetestRunner {
  start(input: { workspaceId: string; agentId: string; goal: string; budgetUsd: number }): Promise<string>;
}

export const engineRunner: RetestRunner = {
  async start(input) {
    // Imported lazily: the engine calls back into this module when runs finish.
    const { createRun } = await import("@/lib/runtime/orchestrator");
    return createRun({ ...input, mode: "live", trigger: "api", purpose: "retest" });
  },
};

async function escalate(row: FindingCaseRow, reason: string) {
  await updateCase(row.id, {
    state: "escalated",
    escalationReason: reason,
    conversation: [...row.conversation, say("platform", `Stopped and handed to a person: ${reason}`)],
  });
  await audit(row.workspaceId, "platform", "case.escalated", "finding_case", row.id, {
    findingId: row.findingId,
    round: row.round,
    spentUsd: row.spentUsd,
    reason,
  });
}

/**
 * Re-run the exact reproduction against the new version, plus a regression
 * set: earlier findings against the same target and fresh synthetic probes.
 */
export async function startRetest(
  caseId: string,
  runner: RetestRunner = engineRunner,
  options: { runBudgetUsd?: number; syntheticCount?: number } = {},
): Promise<FindingCaseRow> {
  const db = getDb();
  const row = await loadCase(caseId);
  caseOpen(row);
  const finding = await loadFinding(row.findingId);
  if (finding.status !== "applied") throw new Error("Apply an approved fix before retesting.");
  const target = await loadAgent(row.targetAgentId);
  const targetTask = target.defaultGoal || target.summary || target.name;

  const others = await db
    .select()
    .from(securityFindings)
    .where(
      and(
        eq(securityFindings.targetAgentId, target.id),
        ne(securityFindings.id, finding.id),
        ne(securityFindings.status, "false_positive"),
      ),
    )
    .limit(3);
  const otherCases = others.length
    ? await db.select().from(findingCases).where(inArray(findingCases.findingId, others.map((f) => f.id)))
    : [];
  const probes: CaseProbe[] = [
    row.reproduction.probe,
    ...others.map((other) => {
      const stored = otherCases.find((c) => c.findingId === other.id)?.reproduction.probe;
      return stored
        ? { ...stored, kind: "regression" as const }
        : buildProbe({ category: other.category, targetTask }, "regression", other.id);
    }),
    ...syntheticBatch(targetTask, options.syntheticCount ?? 2, finding.category),
  ];

  const perRun = options.runBudgetUsd ?? DEFAULT_RETEST_RUN_BUDGET_USD;
  const roundCost = perRun * probes.length;
  if (!roundFitsBudget(row.spentUsd, roundCost, row.budgetCapUsd)) {
    await escalate(
      row,
      `The next retest needs up to $${roundCost.toFixed(2)}, which would pass this loop's $${row.budgetCapUsd.toFixed(2)} cap ($${row.spentUsd.toFixed(2)} already spent).`,
    );
    return loadCase(row.id);
  }

  await moveFinding(finding, "retesting", "platform", { caseId: row.id, round: row.round });
  const retest: CaseRetest = {
    round: row.round,
    version: target.version,
    runs: [],
    queued: probes,
    runBudgetUsd: perRun,
    verdict: "pending",
    failures: [],
    fixture: false,
    costUsd: 0,
    startedAt: new Date().toISOString(),
  };
  await updateCase(row.id, {
    retests: [...row.retests, retest],
    conversation: [
      ...row.conversation,
      say("platform", `Retest started: ${probes.length} runs against version ${target.version}, one at a time.`),
    ],
  });
  await audit(row.workspaceId, "platform", "case.retest_started", "finding_case", row.id, {
    findingId: row.findingId,
    round: row.round,
    version: target.version,
    probes: probes.map((p) => p.kind),
    reservedUsd: roundCost,
  });
  // Starts the first probe.
  return checkRetest(row.id, runner);
}

async function evidenceFor(row: FindingCaseRow, retest: CaseRetest): Promise<{ evidence: RetestEvidence[]; costUsd: number }> {
  const db = getDb();
  const ids = retest.runs.map((r) => r.runId);
  const runRows = ids.length ? await db.select().from(runs).where(inArray(runs.id, ids)) : [];
  const eventRows = ids.length ? await db.select().from(runEvents).where(inArray(runEvents.runId, ids)) : [];
  const raised = ids.length
    ? await db
        .select({ runId: securityFindings.runId })
        .from(securityFindings)
        .where(and(inArray(securityFindings.runId, ids), eq(securityFindings.targetAgentId, row.targetAgentId)))
    : [];
  const evidence = retest.runs.map((r) => {
    const run = runRows.find((x) => x.id === r.runId);
    const rows = eventRows.filter((e) => e.runId === r.runId).sort((a, b) => a.seq - b.seq);
    const events = rows.map((e) => e.payload as unknown as EventLike);
    const lastActivity = Math.max(run?.startedAt.getTime() ?? 0, ...rows.map((e) => e.ts.getTime()));
    const silent = Date.now() - lastActivity > STALL_MS;
    return {
      stalled: (run?.status === "running" || run?.status === "queued") && silent,
      runId: r.runId,
      status: run?.status ?? "failed",
      mode: run?.mode ?? "scripted",
      canaries: r.canaries,
      authored: [...authoredText(events), run?.summary ?? ""],
      findingsAgainstTarget: raised.filter((f) => f.runId === r.runId).length,
    };
  });
  return { evidence, costUsd: runRows.reduce((sum, r) => sum + r.costUsd, 0) };
}

/** One retest step at a time per case, so two callers never start the same probe. */
const caseLocks = new Map<string, Promise<unknown>>();
function withCaseLock<T>(caseId: string, fn: () => Promise<T>): Promise<T> {
  const previous = caseLocks.get(caseId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  caseLocks.set(caseId, next);
  return next.finally(() => {
    if (caseLocks.get(caseId) === next) caseLocks.delete(caseId);
  });
}

/**
 * Move the latest retest forward. Probes run one at a time: when the current
 * run ends clean, the next one starts; the first failure stops the round.
 * Only a pass on every probe leads to "fixed". A failure returns the case to
 * the creator, or escalates after the last round or when the budget is spent.
 */
export function checkRetest(caseId: string, runner: RetestRunner = engineRunner): Promise<FindingCaseRow> {
  return withCaseLock(caseId, () => stepRetest(caseId, runner));
}

async function stepRetest(caseId: string, runner: RetestRunner): Promise<FindingCaseRow> {
  const row = await loadCase(caseId);
  const retest = row.retests[row.retests.length - 1];
  const finding = await loadFinding(row.findingId);
  if (!retest || retest.verdict !== "pending" || finding.status !== "retesting") return row;

  const { evidence, costUsd } = await evidenceFor(row, retest);
  const sofar = evidence.length ? judgeRetest(evidence) : null;
  if (sofar?.verdict === "pending") return row;

  // Retests recorded before probes were queued have no queue.
  const queued = retest.queued ?? [];
  if (queued.length > 0 && (!sofar || sofar.verdict === "passed")) {
    const [next, ...rest] = queued;
    let runId: string;
    try {
      runId = await runner.start({
        workspaceId: row.workspaceId,
        agentId: row.targetAgentId,
        goal: next!.input,
        budgetUsd: retest.runBudgetUsd,
      });
    } catch (error) {
      const reason = `A retest run could not start: ${(error as Error).message}`;
      const failed: CaseRetest = {
        ...retest,
        verdict: "failed",
        failures: [{ runId: "", reason }],
        costUsd,
        finishedAt: new Date().toISOString(),
      };
      await moveFinding(finding, "retest_failed", "platform", { caseId: row.id, reason: "start_failed" });
      await updateCase(row.id, { retests: [...row.retests.slice(0, -1), failed], spentUsd: row.spentUsd + costUsd });
      await escalate(await loadCase(row.id), reason);
      return loadCase(row.id);
    }
    const advanced: CaseRetest = {
      ...retest,
      runs: [...retest.runs, { runId, kind: next!.kind, canaries: next!.canaries, budgetUsd: retest.runBudgetUsd }],
      queued: rest,
    };
    await updateCase(row.id, {
      retests: [...row.retests.slice(0, -1), advanced],
      latestRetestRunId: runId,
    });
    await audit(row.workspaceId, "platform", "case.retest_run_started", "finding_case", row.id, {
      findingId: row.findingId,
      round: row.round,
      runId,
      kind: next!.kind,
      remaining: rest.length,
    });
    return loadCase(row.id);
  }

  const result = sofar!;
  const finished: CaseRetest = {
    ...retest,
    // A failure stops the round; probes that never ran are dropped, not passed.
    queued: [],
    verdict: result.verdict,
    failures: result.failures,
    fixture: result.fixture,
    costUsd,
    finishedAt: new Date().toISOString(),
  };
  const retests = [...row.retests.slice(0, -1), finished];
  const spentUsd = row.spentUsd + costUsd;
  const runIds = retest.runs.map((r) => r.runId);

  if (result.verdict === "passed") {
    await moveFinding(finding, "retest_passed", "platform", { caseId: row.id, runIds, fixture: result.fixture });
    await moveFinding(finding, "fixed", "platform", { caseId: row.id, runIds, version: retest.version });
    const label = result.fixture ? " These runs used the scripted planner, not a live model." : "";
    await updateCase(row.id, {
      retests,
      spentUsd,
      state: "closed",
      conversation: [...row.conversation, say("platform", `Retest passed on all ${runIds.length} runs. The finding is fixed.${label}`)],
    });
    await audit(row.workspaceId, "platform", "case.retest_passed", "finding_case", row.id, {
      findingId: row.findingId,
      round: row.round,
      runIds,
      costUsd,
      fixture: result.fixture,
    });
    return loadCase(row.id);
  }

  await moveFinding(finding, "retest_failed", "platform", { caseId: row.id, runIds });
  const reasons = result.failures.map((f) => `${f.runId}: ${f.reason}`).join("\n");
  await updateCase(row.id, {
    retests,
    spentUsd,
    conversation: [
      ...row.conversation,
      say("platform", `Retest failed in round ${row.round}.\n${reasons}`),
    ],
  });
  await audit(row.workspaceId, "platform", "case.retest_failed", "finding_case", row.id, {
    findingId: row.findingId,
    round: row.round,
    runIds,
    failures: result.failures,
    costUsd,
  });

  const updated = await loadCase(row.id);
  if (afterRetestFailure(row.round, row.maxRounds) === "escalate") {
    await escalate(updated, `The fix failed its retest ${row.round} times.`);
  } else if (spentUsd >= row.budgetCapUsd) {
    await escalate(updated, `This loop spent its $${row.budgetCapUsd.toFixed(2)} budget.`);
  } else {
    await updateCase(row.id, {
      conversation: [
        ...updated.conversation,
        say("platform", "Back to the creator: propose another change, using the retest evidence above."),
      ],
    });
  }
  return loadCase(row.id);
}

/** Called by the run engine when any run ends. Cheap when the run is not a retest. */
export async function noteRunFinished(runId: string): Promise<void> {
  const db = getDb();
  const [run] = await db.select({ purpose: runs.purpose, workspaceId: runs.workspaceId }).from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.purpose !== "retest") return;
  const open = await db
    .select()
    .from(findingCases)
    .where(and(eq(findingCases.workspaceId, run.workspaceId), eq(findingCases.state, "open")));
  for (const row of open) {
    const latest = row.retests[row.retests.length - 1];
    if (latest?.verdict === "pending" && latest.runs.some((r) => r.runId === runId)) {
      await checkRetest(row.id);
    }
  }
}
