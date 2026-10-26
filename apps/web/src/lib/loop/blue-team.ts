/**
 * The blue team repairs agents the red team broke. Plain-language overview:
 * lib/loop/README.md.
 *
 * The Blue Team Lead owns the case queue and works one active case per
 * target. It never does the work itself. Each step goes to a grunt created
 * for that case through the engine's usual spawn path (orchestrator.ts):
 *
 *   Triage       one per finding. Read-only. Confirms the reproduction is
 *                exact, merges duplicates, and completes the case record.
 *   Fix Drafter  one per case. Writes a diff into the creator conversation,
 *                never to the target.
 *   Verifier     one per retest round. Never the case's Fix Drafter.
 *                Reports the retest's run ids.
 *
 * The Healer is a platform action, not an agent: applyFix() in cases.ts, and
 * only after a person approves that one change. Grunts cannot delegate, so
 * the lead starts each retest with case.start_retest, which is also a
 * platform action. Every step here leaves an audit entry.
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  agents,
  findingCases,
  runs,
  type AgentRow,
  type CaseChange,
  type CaseCrew,
  type CaseTriage,
  type FindingCaseRow,
} from "@/lib/db/schema";
import { suggestedChange } from "@/lib/runtime/autoheal";
import { caseIdFromGoal } from "@/lib/runtime/scripts";
import {
  audit,
  caseOpen,
  engineRunner,
  escalate,
  isRedAgent,
  loadAgent,
  loadCase,
  loadFinding,
  moveFinding,
  noteRunFinished as noteRetestRunFinished,
  proposeFix,
  retireCrew,
  say,
  startRetest,
  swarmBudget,
  updateCase,
  type RetestRunner,
} from "./cases";
import { roundFitsBudget } from "./lifecycle";
import { isCanary, TEST_DATA_LABEL } from "./probes";

export type CrewRole = "triage" | "drafter" | "verifier";
export type BluePhase = NonNullable<CaseCrew["dispatched"]>[number]["phase"];

/** One lead run per step. Charged against the swarm's daily cap. */
export const BLUE_LEAD_RUN_BUDGET_USD = 0.5;

/** Starts a run of the Blue Team Lead. */
export interface BlueDispatcher {
  start(input: { workspaceId: string; agentId: string; goal: string; budgetUsd: number }): Promise<string>;
}

export const engineDispatcher: BlueDispatcher = {
  async start(input) {
    // Imported lazily: the engine calls back into this module when runs finish.
    const { createRun } = await import("@/lib/runtime/orchestrator");
    return createRun({ ...input, mode: "live", trigger: "api" });
  },
};

/** The engine by default. Tests swap the retest runner to control outcomes. */
export const blueTeamDeps: { dispatcher: BlueDispatcher; runner: RetestRunner } = {
  dispatcher: engineDispatcher,
  runner: engineRunner,
};

/* ---------- Who is on the blue team ---------- */

export function isBlueLead(agent: Pick<AgentRow, "team" | "rank">): boolean {
  return agent.team === "blue" && agent.rank !== "grunt";
}

export async function blueLeadFor(workspaceId: string): Promise<AgentRow | null> {
  const rows = await (await getDb())
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.team, "blue"), eq(agents.status, "active")))
    .orderBy(asc(agents.createdAt));
  return rows.find(isBlueLead) ?? null;
}

const PHASE_GOAL = /^Blue team (intake|draft|retest): case (case_[0-9a-z]+)\b/;

export function blueGoal(phase: BluePhase, caseId: string, targetName: string): string {
  const what =
    phase === "intake"
      ? `Have Triage check the new finding against ${targetName}.`
      : phase === "draft"
        ? `Have the Fix Drafter propose one change to ${targetName}.`
        : `Have a Verifier take the retest of the fix applied to ${targetName}, then start the retest.`;
  return `Blue team ${phase}: case ${caseId}. ${what}`;
}

export function phaseFromGoal(goal: string): BluePhase | null {
  return (goal.match(PHASE_GOAL)?.[1] as BluePhase | undefined) ?? null;
}

/** Grunts are per case, and Verifiers per round, so their names carry both. */
export async function crewMemberName(caseId: string, role: CrewRole, baseName: string): Promise<string> {
  const row = await loadCase(caseId);
  return role === "verifier" ? `${baseName} · ${row.id} · round ${row.round}` : `${baseName} · ${row.id}`;
}

/**
 * The lead assigns a grunt to one role on one case. Called by the engine when
 * the lead delegates. The rules that keep the parties apart live here:
 * one Triage per finding, one Fix Drafter per case, one Verifier per round,
 * and the Verifier is never the Fix Drafter.
 */
export async function assignCrew(caseId: string, role: CrewRole, memberId: string, leadId: string): Promise<FindingCaseRow> {
  const row = await loadCase(caseId);
  const lead = await loadAgent(leadId);
  if (!isBlueLead(lead) || lead.workspaceId !== row.workspaceId) {
    throw new Error("Only the blue-team lead assigns case work.");
  }
  if (row.crew.leadId && row.crew.leadId !== lead.id) throw new Error("Another blue-team lead owns this case.");
  const member = await loadAgent(memberId);
  if (member.team !== "blue" || isRedAgent(member) || member.rank !== "grunt" || member.parentAgentId !== lead.id) {
    throw new Error(`${member.name} is not one of ${lead.name}'s blue-team grunts.`);
  }

  const crew: CaseCrew = { ...row.crew, leadId: lead.id };
  const verifiers = crew.verifiers ?? [];
  if (role === "triage") {
    if (row.state !== "open" && row.state !== "queued") throw new Error("This case is not taking new work.");
    if (crew.triageId && crew.triageId !== member.id) throw new Error("This finding already has its Triage.");
    if (crew.triageId === member.id) return row;
    crew.triageId = member.id;
  } else if (role === "drafter") {
    caseOpen(row);
    if (!row.triage?.reproduces) throw new Error("Triage has not confirmed this case yet.");
    if (verifiers.some((v) => v.agentId === member.id)) {
      throw new Error("A Verifier on this case cannot also draft its fix.");
    }
    if (crew.drafterId && crew.drafterId !== member.id) throw new Error("This case already has its Fix Drafter.");
    if (crew.drafterId === member.id) return row;
    crew.drafterId = member.id;
  } else {
    caseOpen(row);
    const finding = await loadFinding(row.findingId);
    if (finding.status !== "applied") throw new Error("There is no applied fix to verify yet.");
    if (member.id === crew.drafterId || member.id === row.proposal?.draftedBy) {
      throw new Error("The Verifier must be a different agent from the Fix Drafter for this case.");
    }
    const current = verifiers.find((v) => v.round === row.round);
    if (current && current.agentId !== member.id) throw new Error("This retest already has its Verifier.");
    if (current) return row;
    crew.verifiers = [...verifiers, { agentId: member.id, round: row.round }];
  }

  await updateCase(row.id, { crew });
  await audit(row.workspaceId, `agent:${lead.id}`, "case.crew_assigned", "finding_case", row.id, {
    findingId: row.findingId,
    role,
    agentId: member.id,
    round: row.round,
  });
  return loadCase(row.id);
}

/* ---------- Triage ---------- */

/** What is missing for the reproduction to be exact. Checked by the platform, not taken on an agent's word. */
export function reproductionGaps(row: Pick<FindingCaseRow, "reproduction" | "observed">): string[] {
  const gaps: string[] = [];
  const probe = row.reproduction.probe;
  if (!probe?.input.startsWith(TEST_DATA_LABEL)) gaps.push("The test input is not labeled as synthetic test data.");
  if (!probe?.canaries.length || !probe.canaries.every(isCanary)) {
    gaps.push("The test input has no canary marker, so a repeat could not be detected.");
  }
  if (row.reproduction.steps.length < 3) gaps.push("The steps to repeat it are missing.");
  if (!row.observed.trim()) gaps.push("What the agent did is missing.");
  return gaps;
}

/**
 * Triage reads the case and completes its record. A duplicate of a live case
 * for the same target and kind of problem is merged into it. Otherwise the
 * case becomes active, or waits behind the target's active case.
 */
export async function recordTriage(caseId: string, memberId: string, note = ""): Promise<FindingCaseRow> {
  const db = await getDb();
  const row = await loadCase(caseId);
  if (row.crew.triageId !== memberId) throw new Error("Only this finding's Triage can triage it.");
  if (row.triage) return row;
  if (row.state !== "open" && row.state !== "queued") throw new Error("This case is not taking new work.");
  const finding = await loadFinding(row.findingId);
  const target = await loadAgent(row.targetAgentId);
  const by = `agent:${memberId}`;
  const base = { by, note: note.slice(0, 600), at: new Date().toISOString() };

  const gaps = reproductionGaps(row);
  if (gaps.length > 0) {
    const triage: CaseTriage = { ...base, reproduces: false, gaps, duplicateOf: null };
    await updateCase(row.id, {
      triage,
      conversation: [...row.conversation, say("blue_team", `Triage could not confirm the reproduction. ${gaps.join(" ")}`)],
    });
    await audit(row.workspaceId, by, "case.triaged", "finding_case", row.id, { findingId: row.findingId, reproduces: false, gaps });
    await escalate(await loadCase(row.id), "Triage could not confirm that the reproduction is exact.");
    return loadCase(row.id);
  }

  const sameTarget = await db
    .select()
    .from(findingCases)
    .where(and(eq(findingCases.workspaceId, row.workspaceId), eq(findingCases.targetAgentId, row.targetAgentId)))
    .orderBy(asc(findingCases.createdAt));
  const live = sameTarget.filter(
    (c) => c.id !== row.id && (c.state === "open" || c.state === "queued" || c.state === "escalated"),
  );
  const liveCategories = new Map<string, string>();
  for (const other of live) liveCategories.set(other.id, (await loadFinding(other.findingId)).category);
  const primary = live.find((c) => c.triage?.reproduces && liveCategories.get(c.id) === finding.category);

  if (primary) {
    const triage: CaseTriage = { ...base, reproduces: true, gaps: [], duplicateOf: primary.id };
    await moveFinding(finding, "duplicate", by, { caseId: row.id, duplicateOf: primary.id });
    await updateCase(primary.id, {
      mergedFindingIds: [...primary.mergedFindingIds, finding.id],
      conversation: [...primary.conversation, say("blue_team", `Triage merged a duplicate finding into this case: ${finding.title}.`)],
    });
    await updateCase(row.id, {
      triage,
      state: "closed",
      conversation: [
        ...row.conversation,
        say("blue_team", "Triage found this is the same problem as an earlier case, so it was merged there. That case's retest covers it."),
      ],
    });
    await audit(row.workspaceId, by, "case.merged", "finding_case", row.id, { findingId: finding.id, into: primary.id });
    await retireCrew(await loadCase(row.id));
    return loadCase(row.id);
  }

  const ahead = live.find((c) => c.state === "open" && c.triage);
  const triage: CaseTriage = { ...base, reproduces: true, gaps: [], duplicateOf: null };
  await updateCase(row.id, {
    triage,
    state: ahead ? "queued" : "open",
    conversation: [
      ...row.conversation,
      say(
        "blue_team",
        ahead
          ? `Triage confirmed the reproduction. Another fix for ${target.name} is in progress, so this case waits its turn.`
          : "Triage confirmed the reproduction: the test input, what the agent did, and the steps to repeat it are on record.",
      ),
    ],
  });
  await audit(row.workspaceId, by, "case.triaged", "finding_case", row.id, {
    findingId: row.findingId,
    reproduces: true,
    queuedBehind: ahead?.id ?? null,
  });
  return loadCase(row.id);
}

/* ---------- Fix Drafter ---------- */

/**
 * The Fix Drafter's diff goes into the creator conversation for a person to
 * approve. It never touches the target. Without a model-written change it
 * offers the built-in suggestion, which already follows the preferred order:
 * the target's own instructions first, then a locked rule for it alone.
 */
export async function draftFix(
  caseId: string,
  memberId: string,
  input: { change?: CaseChange; reply?: string } = {},
): Promise<FindingCaseRow> {
  const row = await loadCase(caseId);
  caseOpen(row);
  if (!row.crew.drafterId || row.crew.drafterId !== memberId) {
    throw new Error("Only this case's Fix Drafter can draft its fix.");
  }
  const finding = await loadFinding(row.findingId);
  if (finding.status !== "accepted" && finding.status !== "retest_failed") {
    throw new Error(`There is nothing to draft: the finding is ${finding.status.replaceAll("_", " ")}.`);
  }
  const target = await loadAgent(row.targetAgentId);
  const last = row.retests[row.retests.length - 1];
  const evidence =
    finding.status === "retest_failed" && last?.failures.length
      ? ` The last fix failed its retest: ${last.failures.map((f) => f.reason).join(" ")}`
      : "";
  return proposeFix(row.id, {
    change: input.change ?? suggestedChange(target, finding),
    source: input.change ? "live" : "suggested",
    draftedBy: memberId,
    reply:
      input.reply?.trim() ||
      `The blue team drafted this change for ${target.name} only.${evidence} Nothing changes until you approve it.`,
  });
}

/* ---------- Verifier ---------- */

export async function verifierReport(caseId: string, memberId: string): Promise<string> {
  const row = await loadCase(caseId);
  const mine = (row.crew.verifiers ?? []).find((v) => v.agentId === memberId && v.round === row.round);
  if (!mine) throw new Error("Only this round's Verifier can report on its retest.");
  const retest = row.retests[row.retests.length - 1];
  const runIds = retest && retest.round === row.round ? retest.runs.map((r) => r.runId) : [];
  await audit(row.workspaceId, `agent:${memberId}`, "case.verifier_reported", "finding_case", row.id, {
    findingId: row.findingId,
    round: row.round,
    runIds,
  });
  if (!retest || retest.round !== row.round) {
    return `Round ${row.round}: no retest has started yet. The lead starts it next. I will be the Verifier of record.`;
  }
  const listed = retest.runs.map((r) => `${r.runId} (${r.kind})`).join(", ") || "none yet";
  return `Round ${retest.round}: ${retest.verdict}. Runs: ${listed}. ${retest.queued.length} still to run.`;
}

/* ---------- The lead's platform action ---------- */

export async function leadStartRetest(
  caseId: string,
  leadId: string,
  runner: RetestRunner = blueTeamDeps.runner,
): Promise<FindingCaseRow> {
  const row = await loadCase(caseId);
  const lead = await loadAgent(leadId);
  if (!isBlueLead(lead) || row.crew.leadId !== lead.id) {
    throw new Error("Only the blue-team lead that owns this case can start its retest.");
  }
  const verifier = (row.crew.verifiers ?? []).find((v) => v.round === row.round);
  if (!verifier) throw new Error("Hand the retest to a Verifier first.");
  return startRetest(row.id, runner, { verifierId: verifier.agentId, requestedBy: `agent:${lead.id}` });
}

/* ---------- Moving cases forward ---------- */

/** The lead's next step for a case, or null when it waits on a person, a retest, or another case. */
export function nextPhase(row: FindingCaseRow, findingStatus: string): BluePhase | null {
  if (!row.deliveredTo) return null;
  if (row.state === "open" && !row.triage) return "intake";
  if (row.state !== "open" || !row.triage?.reproduces) return null;
  if (findingStatus === "accepted" || findingStatus === "retest_failed") return "draft";
  if (findingStatus === "applied") return "retest";
  return null;
}

/**
 * Start the lead's next step for one case as a run. Each step runs once per
 * round; one that ends without progress goes to a person instead of looping.
 */
export async function advanceCase(
  caseId: string,
  dispatcher: BlueDispatcher = blueTeamDeps.dispatcher,
): Promise<{ phase: BluePhase; runId: string } | null> {
  const row = await loadCase(caseId);
  const lead = await blueLeadFor(row.workspaceId);
  if (!lead || (row.crew.leadId && row.crew.leadId !== lead.id)) return null;
  const finding = await loadFinding(row.findingId);
  const phase = nextPhase(row, finding.status);
  if (!phase) return null;
  const dispatched = row.crew.dispatched ?? [];
  if (dispatched.some((d) => d.phase === phase && d.round === row.round)) return null;

  const swarm = await swarmBudget(row.workspaceId);
  if (!roundFitsBudget(swarm.spentUsd, BLUE_LEAD_RUN_BUDGET_USD, swarm.capUsd)) {
    await escalate(
      row,
      `The blue team's next step needs up to $${BLUE_LEAD_RUN_BUDGET_USD.toFixed(2)}, which would pass the red and blue teams' $${swarm.capUsd.toFixed(2)} daily cap ($${swarm.spentUsd.toFixed(2)} already spent today).`,
    );
    return null;
  }

  // Recorded before the run starts, so a fast run cannot finish unrecorded.
  const entry = { phase, round: row.round, runId: "", at: new Date().toISOString() };
  await updateCase(row.id, { crew: { ...row.crew, leadId: lead.id, dispatched: [...dispatched, entry] } });
  const target = await loadAgent(row.targetAgentId);
  let runId: string;
  try {
    runId = await dispatcher.start({
      workspaceId: row.workspaceId,
      agentId: lead.id,
      goal: blueGoal(phase, row.id, target.name),
      budgetUsd: BLUE_LEAD_RUN_BUDGET_USD,
    });
  } catch (error) {
    await escalate(await loadCase(row.id), `The blue team could not start its ${phase} step: ${(error as Error).message}`);
    return null;
  }
  const current = await loadCase(row.id);
  await updateCase(row.id, {
    crew: {
      ...current.crew,
      dispatched: (current.crew.dispatched ?? []).map((d) =>
        d.phase === phase && d.round === entry.round && !d.runId ? { ...d, runId } : d,
      ),
    },
  });
  await audit(row.workspaceId, "platform", "case.blue_dispatched", "finding_case", row.id, {
    findingId: row.findingId,
    phase,
    round: row.round,
    runId,
    leadId: lead.id,
  });
  return { phase, runId };
}

/**
 * After the Healer applies a fix, the lead's Verifier takes the retest and the
 * lead starts it. A workspace with no blue team retests straight away.
 */
export async function retestApplied(caseId: string): Promise<FindingCaseRow> {
  const row = await loadCase(caseId);
  if (await blueLeadFor(row.workspaceId)) {
    await advanceCase(row.id);
    return loadCase(row.id);
  }
  return startRetest(row.id, blueTeamDeps.runner);
}

/** Advance every active or untriaged case for one target, oldest first. */
export async function advanceTarget(workspaceId: string, targetAgentId: string): Promise<void> {
  const rows = await (await getDb())
    .select({ id: findingCases.id })
    .from(findingCases)
    .where(
      and(
        eq(findingCases.workspaceId, workspaceId),
        eq(findingCases.targetAgentId, targetAgentId),
        eq(findingCases.state, "open"),
      ),
    )
    .orderBy(asc(findingCases.createdAt));
  for (const { id } of rows) await advanceCase(id);
}

/**
 * Called by the run engine when a run ends. A retest run moves its case's
 * retest forward. A lead run that ended without finishing its step hands the
 * case to a person. Either way the target's cases then move on.
 */
export async function noteRunFinished(runId: string): Promise<void> {
  const db = await getDb();
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) return;
  if (run.purpose === "retest") {
    await noteRetestRunFinished(runId);
    await advanceTarget(run.workspaceId, run.agentId);
    return;
  }
  const phase = phaseFromGoal(run.goal);
  const caseId = caseIdFromGoal(run.goal);
  if (!phase || !caseId) return;
  const [lead] = await db.select().from(agents).where(eq(agents.id, run.agentId)).limit(1);
  if (!lead || !isBlueLead(lead)) return;
  const row = await loadCase(caseId).catch(() => null);
  if (!row || row.workspaceId !== run.workspaceId) return;
  const finding = await loadFinding(row.findingId);
  if (nextPhase(row, finding.status) === phase) {
    await escalate(row, `The blue team's ${phase} step ended without finishing. See run ${runId}.`);
  }
  await advanceTarget(row.workspaceId, row.targetAgentId);
}

/** A plain account of a case for the blue team's case.read tool. Never includes the probe or its canary. */
export async function describeCase(caseId: string): Promise<string> {
  const row = await loadCase(caseId);
  const finding = await loadFinding(row.findingId);
  const target = await loadAgent(row.targetAgentId);
  const last = row.retests[row.retests.length - 1];
  return [
    `Case ${row.id} for ${target.name} (version ${target.version}). Severity ${row.severity}.`,
    `State: ${row.state}. Finding: ${finding.status.replaceAll("_", " ")}. Round ${row.round} of ${row.maxRounds}.`,
    `What the red team saw: ${row.observed}`,
    `Steps to repeat it:\n${row.reproduction.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    row.triage ? `Triage: ${row.triage.reproduces ? "reproduction confirmed" : `not confirmed (${row.triage.gaps.join(" ")})`}.` : "Triage: not done yet.",
    row.proposal ? `Current proposal: ${row.proposal.summary}\n${row.proposal.diff}` : "No proposal yet.",
    last ? `Last retest, round ${last.round}: ${last.verdict}. ${last.failures.map((f) => f.reason).join(" ")}` : "No retest yet.",
    `Budget: $${row.spentUsd.toFixed(2)} of $${row.budgetCapUsd.toFixed(2)} spent.`,
  ].join("\n");
}
