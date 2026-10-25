import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TerminalSquare } from "@/components/icons";
import { projectRun } from "@agent-os/core";
import { AgentConsole, type ConsoleToolCall } from "@/components/console/agent-console";
import { PageHeader, StatusBadge } from "@/components/ui/primitives";
import {
  getAgent,
  getRunEvents,
  getWorkspaceContext,
  listBudgetPolicies,
  listRuns,
} from "@/lib/queries";
import { AgentSandbox } from "@/lib/runtime/sandbox";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AgentConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();

  const ctx = await getWorkspaceContext();
  const [runs, policies] = await Promise.all([
    listRuns(agent.workspaceId, { agentId: agent.id, limit: 5 }),
    listBudgetPolicies(agent.workspaceId),
  ]);

  const sandbox = new AgentSandbox(env.sandboxRoot, agent.workspaceId, agent.id);
  if (!sandbox.exists()) {
    sandbox.provision({
      agentName: agent.name,
      role: agent.role,
      summary: agent.summary || agent.instructions.slice(0, 200),
    });
  }

  const tree = sandbox.tree();
  const latest = runs[0] ?? null;
  let toolCalls: ConsoleToolCall[] = [];
  let toolCallRunId: string | null = null;

  // The latest run may be a pure-delegation turn (no direct tool calls by this
  // agent). Walk back until a run shows this agent touching its sandbox.
  for (const run of runs) {
    const events = await getRunEvents(run.id);
    const projection = projectRun(events, run.id);
    const calls = [...projection.toolCalls.values()]
      .filter((call) => call.agentId === agent.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 15);
    if (calls.length > 0) {
      toolCallRunId = run.id;
      toolCalls = calls.map((call) => ({
        id: call.id,
        tool: call.tool,
        status: call.status,
        durationMs: call.durationMs,
        preview: call.resultPreview,
        error: call.error,
        at: call.startedAt,
      }));
      break;
    }
  }

  const runPolicy = policies.find(
    (policy) => policy.agentId === agent.id && policy.period === "run",
  );
  const dayPolicy = policies.find((policy) => policy.agentId === null && policy.period === "day");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/agents/${agent.id}`}
          className="focus-ring mono flex items-center gap-1 text-[10px] text-ink-4 hover:text-ink-2"
        >
          <ArrowLeft size={10} /> {agent.name}
        </Link>
        <span className="text-line-strong">/</span>
        <span className="mono flex items-center gap-1 text-[10px] text-ink-3">
          <TerminalSquare size={10} /> console
        </span>
        <StatusBadge status={agent.status} className="ml-auto" />
      </div>

      <PageHeader
        eyebrow={`${agent.role} · ${agent.id}`}
        title={`${agent.name} workspace`}
        description="A real directory on disk. The model reads and writes here through the same tool executor the runs use; paths are confined to this root and every write is audited."
        actions={
          <span className="mono text-[10px] text-ink-4">
            {agent.allowedTools.length} tools · {agent.grants.length} grants
          </span>
        }
      />

      <AgentConsole
        agentId={agent.id}
        agentName={agent.name}
        role={agent.role}
        status={agent.status}
        summary={agent.summary}
        model={
          agent.modelPolicy.mode === "pinned"
            ? (agent.modelPolicy.pinnedModelId ?? "pinned")
            : "auto-routed per turn"
        }
        dataClass={agent.dataClass}
        initialTree={tree}
        root={`workspaces/${agent.workspaceId}/${agent.id}`}
        toolCalls={toolCalls}
        toolCallRunId={toolCallRunId}
        recentRun={
          latest
            ? {
                id: latest.id,
                status: latest.status,
                goal: latest.goal,
                costUsd: latest.costUsd,
                inputTokens: latest.inputTokens,
                outputTokens: latest.outputTokens,
                startedAt: latest.startedAt.toISOString(),
              }
            : null
        }
        budgets={{
          runUsd: runPolicy?.limitUsd ?? null,
          dayUsd: dayPolicy?.limitUsd ?? null,
          spentTodayUsd: ctx.spendTodayUsd,
        }}
      />
    </div>
  );
}
