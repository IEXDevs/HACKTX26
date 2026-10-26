/**
 * Eval runner.
 *
 * Scores a suite against the agent's recorded traces rather than against a
 * hand-written number: each case is matched to the most lexically similar run
 * for that agent, then tool-call accuracy is the fraction of the case's
 * expected tools that the trace actually requested. Runs that do not exist yet
 * simply fail their case, which is the honest result.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { RunEventPayload } from "@agent-os/core";
import { getDb } from "@/lib/db/client";
import {
  approvals,
  evalRuns,
  evalSuites,
  runEvents,
  runs,
  type EvalRunRow,
} from "@/lib/db/schema";
import { newId } from "@/lib/env";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "after", "before", "from", "that", "this", "into",
  "then", "than", "when", "what", "which", "have", "has", "was", "were", "are",
  "not", "but", "all", "any", "can", "does", "did", "its", "our", "their", "they",
  "you", "your", "should", "would", "could", "must", "may", "one", "two", "per",
  "run", "case", "test", "agent",
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length > 2 && !STOPWORDS.has(word)) out.add(word);
  }
  return out;
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / a.size;
}

export interface EvalCaseResult {
  caseId: string;
  name: string;
  input: string;
  expectedTools: string[];
  observedTools: string[];
  missingTools: string[];
  matchedRunId: string | null;
  coverage: number;
  passed: boolean;
  note: string;
}

export interface EvalRunResult {
  row: EvalRunRow;
  cases: EvalCaseResult[];
  matchedRuns: number;
}

export async function runEvalSuite(
  workspaceId: string,
  suiteId: string,
): Promise<EvalRunResult> {
  const db = await getDb();
  const [suite] = await db
    .select()
    .from(evalSuites)
    .where(eq(evalSuites.id, suiteId))
    .limit(1);

  if (!suite || suite.workspaceId !== workspaceId) {
    throw new Error("Eval suite not found.");
  }

  const candidateRuns = await db
    .select()
    .from(runs)
    .where(and(eq(runs.workspaceId, workspaceId), eq(runs.agentId, suite.agentId)))
    .orderBy(desc(runs.startedAt))
    .limit(25);

  const runIds = candidateRuns.map((run) => run.id);

  const [eventRows, approvalRows] = await Promise.all([
    runIds.length
      ? db.select().from(runEvents).where(inArray(runEvents.runId, runIds))
      : Promise.resolve([]),
    runIds.length
      ? db.select().from(approvals).where(inArray(approvals.runId, runIds))
      : Promise.resolve([]),
  ]);

  const toolsByRun = new Map<string, Set<string>>();
  for (const row of eventRows) {
    const payload = row.payload as RunEventPayload;
    if (payload.type !== "tool.requested") continue;
    const set = toolsByRun.get(row.runId) ?? new Set<string>();
    set.add(payload.tool);
    toolsByRun.set(row.runId, set);
  }

  const tokensByRun = new Map(
    candidateRuns.map((run) => [run.id, tokens(run.goal)] as const),
  );

  /**
   * One-to-one assignment, best pair first. Letting a single trace answer every
   * case would inflate coverage: two different inputs would silently score
   * against the same execution.
   */
  const pairs: Array<{ caseId: string; runId: string; score: number; degraded: number }> = [];
  for (const testCase of suite.cases) {
    const caseTokens = tokens(`${testCase.name} ${testCase.input}`);
    for (const run of candidateRuns) {
      const score = similarity(caseTokens, tokensByRun.get(run.id) ?? new Set());
      if (score > 0) {
        pairs.push({
          caseId: testCase.id,
          runId: run.id,
          score,
          // At equal lexical distance prefer a completed execution over one that
          // was halted mid-flight; otherwise a budget-killed trace can win the tie.
          degraded: run.status === "succeeded" ? 0 : 1,
        });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.degraded - b.degraded);

  const MATCH_FLOOR = 0.2;
  const matchByCase = new Map<string, { runId: string; score: number }>();
  const claimedRuns = new Set<string>();
  for (const pair of pairs) {
    if (pair.score < MATCH_FLOOR) break;
    if (matchByCase.has(pair.caseId) || claimedRuns.has(pair.runId)) continue;
    matchByCase.set(pair.caseId, { runId: pair.runId, score: pair.score });
    claimedRuns.add(pair.runId);
  }

  const cases: EvalCaseResult[] = [];

  for (const testCase of suite.cases) {
    const best = matchByCase.get(testCase.id);

    if (!best) {
      cases.push({
        caseId: testCase.id,
        name: testCase.name,
        input: testCase.input,
        expectedTools: testCase.expectedTools,
        observedTools: [],
        missingTools: testCase.expectedTools,
        matchedRunId: null,
        coverage: 0,
        passed: false,
        note: "No unclaimed recorded run for this agent is similar enough to this case.",
      });
      continue;
    }

    const observed = toolsByRun.get(best.runId) ?? new Set<string>();
    const missingTools = testCase.expectedTools.filter((tool) => !observed.has(tool));
    const coverage =
      testCase.expectedTools.length === 0
        ? 1
        : (testCase.expectedTools.length - missingTools.length) /
          testCase.expectedTools.length;

    cases.push({
      caseId: testCase.id,
      name: testCase.name,
      input: testCase.input,
      expectedTools: testCase.expectedTools,
      observedTools: [...observed],
      missingTools,
      matchedRunId: best.runId,
      coverage: Number(coverage.toFixed(3)),
      passed: missingTools.length === 0,
      note:
        missingTools.length === 0
          ? `All ${testCase.expectedTools.length} expected tools appear in the trace.`
          : `Trace never requested: ${missingTools.join(", ")}.`,
    });
  }

  const casesPassed = cases.filter((testCase) => testCase.passed).length;
  const casesTotal = cases.length;
  const toolCallAccuracy =
    casesTotal === 0
      ? 0
      : cases.reduce((sum, testCase) => sum + testCase.coverage, 0) / casesTotal;

  const matchedRunIds = new Set(
    cases.map((testCase) => testCase.matchedRunId).filter((id): id is string => Boolean(id)),
  );
  const taskSuccess =
    matchedRunIds.size === 0
      ? 0
      : candidateRuns.filter(
          (run) => matchedRunIds.has(run.id) && run.status === "succeeded",
        ).length / matchedRunIds.size;

  const runsWithApprovals = new Set(approvalRows.map((row) => row.runId));
  const interventionRate =
    candidateRuns.length === 0 ? 0 : runsWithApprovals.size / candidateRuns.length;

  const startedAt = new Date();
  const row: EvalRunRow = {
    id: newId("er"),
    workspaceId,
    suiteId,
    runId: cases.find((testCase) => testCase.matchedRunId)?.matchedRunId ?? null,
    status: toolCallAccuracy >= 0.8 ? "passed" : "failed",
    toolCallAccuracy: Number(toolCallAccuracy.toFixed(3)),
    taskSuccess: Number(taskSuccess.toFixed(3)),
    interventionRate: Number(interventionRate.toFixed(3)),
    casesPassed,
    casesTotal,
    startedAt,
    endedAt: new Date(),
  };

  await db.insert(evalRuns).values(row);

  return { row, cases, matchedRuns: matchedRunIds.size };
}

export async function runEvalSuites(
  workspaceId: string,
  suiteIds: string[],
): Promise<{ results: EvalRunResult[]; casesPassed: number; casesTotal: number; failed: number }> {
  const results: EvalRunResult[] = [];
  for (const suiteId of suiteIds) {
    results.push(await runEvalSuite(workspaceId, suiteId));
  }
  return {
    results,
    casesPassed: results.reduce((sum, result) => sum + result.row.casesPassed, 0),
    casesTotal: results.reduce((sum, result) => sum + result.row.casesTotal, 0),
    failed: results.filter((result) => result.row.status === "failed").length,
  };
}
