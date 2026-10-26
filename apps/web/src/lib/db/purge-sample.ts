/**
 * `pnpm db:purge-sample` removes the sample company from an existing database:
 * the made-up people, agents, runs, findings, connectors, and history that older
 * boots seeded. It keeps the platform config, the two team leads, and anything
 * people created themselves.
 *
 * It is a dry run unless you pass `--apply`:
 *   pnpm db:purge-sample             show what would go
 *   pnpm db:purge-sample -- --apply  delete it
 *
 * Stop the dev server before applying. Live runs that were made against a sample
 * agent go with that agent, and the dry run says how much real spend that is.
 */
import type { AppDatabase } from "./client";
import { queryRows } from "./raw";

/** The ids only the sample seed creates. A test keeps this list equal to seedDatabase() minus seedPlatform(). */
export const SAMPLE_IDS = {
  users: ["usr_sid", "usr_maya", "usr_dev"],
  agents: [
    "agt_incident_commander",
    "agt_log_triage",
    "agt_patch_author",
    "agt_comms",
    "agt_code_reviewer",
    "agt_vendor_review",
    "agt_batch_ops",
  ],
  connectors: ["con_github", "con_datadog", "con_kb", "con_okta", "con_web"],
  credentials: ["cred_github", "cred_datadog", "cred_okta"],
  runs: ["run_01_incident", "run_02_redteam", "run_03_review", "run_04_contract", "run_05_backfill"],
  approvals: ["apr_seed_shell", "apr_seed_secret", "apr_seed_merge", "apr_seed_batch", "apr_seed_contract"],
  memories: ["mem_1", "mem_2", "mem_3", "mem_4", "mem_5", "mem_6"],
  findings: ["fnd_1", "fnd_2", "fnd_3", "fnd_4"],
  evalSuites: ["es_incident", "es_patch", "es_redteam"],
  triggers: [
    "trg_alert_digest",
    "trg_pagerduty",
    "trg_pr_opened",
    "trg_redteam_nightly",
    "trg_contract_manual",
    "trg_batch",
  ],
  budgetPolicies: ["bp_incident_run", "bp_batch_run", "bp_batch_month"],
  auditLog: ["aud_1", "aud_2", "aud_3", "aud_4", "aud_5", "aud_6", "aud_7", "aud_8", "aud_9", "aud_10", "aud_11"],
} as const;

/** Platform infrastructure. Older seeds hung the red team under a sample agent, so it must be protected and freed. */
const PROTECTED_AGENTS = ["agt_red_team", "agt_blue_team"] as const;

export interface PurgeReport {
  applied: boolean;
  /** Rows per table that were (or would be) removed. */
  removed: Record<string, number>;
  /** Team leads whose sample parent was removed, so they stand alone now. */
  reparented: number;
  /** What the removed runs cost, split into sample replays and real model spend. */
  runs: { total: number; replay: number; live: number; liveCostUsd: number };
}

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

export async function purgeSample(database: AppDatabase, options: { apply: boolean }): Promise<PurgeReport> {
  return database.transaction(async (db) => {
  const column = async (statement: string, ...params: unknown[]) =>
    (await queryRows<Record<string, string>>(db, statement, params)).map((row) => Object.values(row)[0]!);
  const inList = (ids: readonly string[]) => (ids.length ? `in (${marks(ids.length)})` : "in (null)");

  // Agents: the sample ones, plus anything they spawned. The team leads are never removed.
  const agentIds = new Set<string>(SAMPLE_IDS.agents);
  for (let grew = true; grew; ) {
    const known = [...agentIds];
    const children = await column(
      `select id from astronom.agents where parent_agent_id ${inList(known)} and id not ${inList(PROTECTED_AGENTS)}`,
      ...known,
      ...PROTECTED_AGENTS,
    );
    grew = false;
    for (const id of children) {
      if (!agentIds.has(id)) {
        agentIds.add(id);
        grew = true;
      }
    }
  }
  const agents = [...agentIds];

  // Runs: the sample ones, every replay, and anything run against a doomed agent.
  const runIds = new Set<string>([
    ...await column(`select id from astronom.runs where id ${inList(SAMPLE_IDS.runs)}`, ...SAMPLE_IDS.runs),
    ...await column(`select id from astronom.runs where mode = 'replay'`),
    ...await column(`select id from astronom.runs where agent_id ${inList(agents)}`, ...agents),
  ]);
  const runs = [...runIds];

  const suites = new Set<string>([
    ...await column(`select id from astronom.eval_suites where id ${inList(SAMPLE_IDS.evalSuites)}`, ...SAMPLE_IDS.evalSuites),
    ...await column(`select id from astronom.eval_suites where agent_id ${inList(agents)}`, ...agents),
  ]);
  const suiteIds = [...suites];

  const findings = [
    ...new Set<string>([
      ...await column(`select id from astronom.security_findings where id ${inList(SAMPLE_IDS.findings)}`, ...SAMPLE_IDS.findings),
      ...await column(`select id from astronom.security_findings where run_id ${inList(runs)}`, ...runs),
      ...await column(`select id from astronom.security_findings where target_agent_id ${inList(agents)}`, ...agents),
    ]),
  ];

  const cases = [
    ...new Set<string>([
      ...await column(`select id from astronom.finding_cases where finding_id ${inList(findings)}`, ...findings),
      ...await column(`select id from astronom.finding_cases where target_agent_id ${inList(agents)}`, ...agents),
      ...await column(`select id from astronom.finding_cases where source_run_id ${inList(runs)}`, ...runs),
    ]),
  ];

  const approvals = [
    ...new Set<string>([
      ...await column(`select id from astronom.approvals where id ${inList(SAMPLE_IDS.approvals)}`, ...SAMPLE_IDS.approvals),
      ...await column(`select id from astronom.approvals where run_id ${inList(runs)}`, ...runs),
      ...await column(`select id from astronom.approvals where agent_id ${inList(agents)}`, ...agents),
    ]),
  ];

  const memories = [
    ...new Set<string>([
      ...await column(`select id from astronom.memories where id ${inList(SAMPLE_IDS.memories)}`, ...SAMPLE_IDS.memories),
      ...await column(`select id from astronom.memories where agent_id ${inList(agents)}`, ...agents),
      ...await column(`select id from astronom.memories where source_run_id ${inList(runs)}`, ...runs),
    ]),
  ];

  // Order matters: children first.
  const steps: Array<{ table: string; where: string; params: readonly string[] }> = [
    { table: "run_events", where: `run_id ${inList(runs)}`, params: runs },
    { table: "task_log", where: `run_id ${inList(runs)}`, params: runs },
    {
      table: "eval_runs",
      where: `suite_id ${inList(suiteIds)} or run_id ${inList(runs)}`,
      params: [...suiteIds, ...runs],
    },
    { table: "approvals", where: `id ${inList(approvals)}`, params: approvals },
    { table: "memories", where: `id ${inList(memories)}`, params: memories },
    { table: "finding_cases", where: `id ${inList(cases)}`, params: cases },
    { table: "security_findings", where: `id ${inList(findings)}`, params: findings },
    { table: "agent_versions", where: `agent_id ${inList(agents)}`, params: agents },
    {
      table: "triggers",
      where: `id ${inList(SAMPLE_IDS.triggers)} or agent_id ${inList(agents)}`,
      params: [...SAMPLE_IDS.triggers, ...agents],
    },
    {
      table: "budget_policies",
      where: `id ${inList(SAMPLE_IDS.budgetPolicies)} or agent_id ${inList(agents)}`,
      params: [...SAMPLE_IDS.budgetPolicies, ...agents],
    },
    { table: "eval_suites", where: `id ${inList(suiteIds)}`, params: suiteIds },
    {
      table: "template_proposals",
      where: `parent_agent_id ${inList(agents)} or run_id ${inList(runs)}`,
      params: [...agents, ...runs],
    },
    {
      table: "audit_log",
      where: `id ${inList(SAMPLE_IDS.auditLog)} or target_id ${inList([...agents, ...runs, ...findings, ...cases, ...approvals])}`,
      params: [...SAMPLE_IDS.auditLog, ...agents, ...runs, ...findings, ...cases, ...approvals],
    },
    { table: "runs", where: `id ${inList(runs)}`, params: runs },
    { table: "agents", where: `id ${inList(agents)}`, params: agents },
    { table: "connectors", where: `id ${inList(SAMPLE_IDS.connectors)}`, params: SAMPLE_IDS.connectors },
    { table: "credentials", where: `id ${inList(SAMPLE_IDS.credentials)}`, params: SAMPLE_IDS.credentials },
    { table: "users", where: `id ${inList(SAMPLE_IDS.users)}`, params: SAMPLE_IDS.users },
  ];

  const present = new Set(await column(`select tablename from pg_tables where schemaname = 'astronom'`));
  const [costRow] = await queryRows<{ total: number; replay: number; live: number; liveCostUsd: number }>(db,
    `select count(*)::int total,
      coalesce(sum(case when mode = 'replay' then 1 else 0 end), 0)::int replay,
      coalesce(sum(case when mode != 'replay' then 1 else 0 end), 0)::int live,
      coalesce(sum(case when mode != 'replay' then cost_usd else 0 end), 0) as "liveCostUsd"
      from astronom.runs where id ${inList(runs)}`, runs);
  const removed: Record<string, number> = {};
  const orphanedLeads = `id ${inList(PROTECTED_AGENTS)} and parent_agent_id ${inList(agents)}`;
  const orphanedParams = [...PROTECTED_AGENTS, ...agents];
  const reparented = (await queryRows<{ c: number }>(db, `select count(*)::int c from astronom.agents where ${orphanedLeads}`, orphanedParams))[0]!.c;
  if (options.apply && reparented > 0) {
    await queryRows(db, `update astronom.agents set parent_agent_id = null where ${orphanedLeads}`, orphanedParams);
  }
  for (const step of steps) {
    if (!present.has(step.table)) continue;
    const count = (await queryRows<{ c: number }>(db, `select count(*)::int c from astronom.${step.table} where ${step.where}`, step.params))[0]!.c;
    removed[step.table] = count;
    if (options.apply && count > 0) {
      await queryRows(db, `delete from astronom.${step.table} where ${step.where}`, step.params);
    }
  }

  return {
    applied: options.apply,
    removed,
    reparented,
    runs: {
      total: costRow!.total,
      replay: costRow!.replay ?? 0,
      live: costRow!.live ?? 0,
      liveCostUsd: Number(costRow!.liveCostUsd.toFixed(4)),
    },
  };
  });
}

async function main() {
  const { env } = await import("@/lib/env");
  if (env.isProduction) throw new Error("db:purge-sample is disabled in production.");
  const { getDb } = await import("./client");
  const apply = process.argv.includes("--apply");
  const report = await purgeSample(await getDb(), { apply });

  const rows = Object.entries(report.removed).filter(([, count]) => count > 0);
   
  console.log(apply ? "[purge] removed:" : "[purge] dry run, would remove:");
  for (const [table, count] of rows) {
     
    console.log(`  ${table.padEnd(20)} ${count}`);
  }
   
  if (report.reparented > 0) {
     
    console.log(`[purge] ${report.reparented} team lead(s) lose their sample parent and stand alone`);
  }
   
  console.log(
    `[purge] runs: ${report.runs.total} (${report.runs.replay} sample replays, ${report.runs.live} live runs that cost $${report.runs.liveCostUsd.toFixed(2)})`,
  );
  if (!apply) {
     
    console.log("[purge] nothing was deleted. Re-run with `-- --apply` after stopping the dev server.");
  }
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /purge-sample\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
       
      console.error(error);
      process.exit(1);
    });
}
