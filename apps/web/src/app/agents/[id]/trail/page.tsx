import Link from "next/link";
import { notFound } from "next/navigation";
import { MODEL_BY_ID, projectRun } from "@agent-os/core";
import { ArrowLeft, Bot, FolderOpen, ScrollText } from "@/components/icons";
import { AgentTrail, type TrailCall, type TrailFile, type TrailThought } from "@/components/agents/agent-trail";
import { LiveRefresh } from "@/components/relay/live-refresh";
import { StatusBadge } from "@/components/ui/primitives";
import { getAgent, getRunEvents, getWorkspace, listAgents, listRuns } from "@/lib/queries";
import { routedModel } from "@/lib/views";
import { plainText } from "@/lib/plain-text";

export const dynamic = "force-dynamic";

export default async function AgentTrailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();

  const [all, workspace] = await Promise.all([
    listAgents(agent.workspaceId),
    getWorkspace(),
  ]);
  const denied = workspace?.deniedModelIds ?? [];
  let rootId = agent.id;
  let cursor = agent;
  while (cursor.parentAgentId) {
    const parent = all.find((row) => row.id === cursor.parentAgentId);
    if (!parent) break;
    cursor = parent;
    rootId = parent.id;
  }

  const [own, workflowRuns] = await Promise.all([
    listRuns(agent.workspaceId, { agentId: agent.id, limit: 8 }),
    listRuns(agent.workspaceId, { agentId: rootId, limit: 8 }),
  ]);
  const seen = new Set<string>();
  const runs = [...own, ...workflowRuns].filter((run) => {
    if (seen.has(run.id)) return false;
    seen.add(run.id);
    return true;
  });

  const calls: TrailCall[] = [];
  const thoughts: TrailThought[] = [];
  const files: TrailFile[] = [];
  let model = routedModel(agent, denied);

  for (const run of runs) {
    const projection = projectRun(await getRunEvents(run.id), run.id);
    const mine = projection.agents.get(agent.id);
    if (mine?.model && !denied.includes(mine.model)) {
      model = MODEL_BY_ID.get(mine.model)?.label ?? mine.model;
    }
    for (const call of projection.toolCalls.values()) {
      if (call.agentId !== agent.id) continue;
      calls.push({
        id: call.id,
        runId: run.id,
        tool: call.tool,
        status: call.status,
        preview: call.resultPreview ? plainText(call.resultPreview).slice(0, 240) : null,
        error: call.error,
        at: call.startedAt,
        durationMs: call.durationMs,
      });
    }
    for (const entry of projection.transcript) {
      if (entry.agentId !== agent.id || entry.delta || entry.role !== "assistant") continue;
      const text = plainText(entry.text).trim();
      if (text.length < 12) continue;
      thoughts.push({ runId: run.id, text: text.slice(0, 320), at: entry.ts });
    }
    for (const file of projection.files) {
      if (file.agentId !== agent.id) continue;
      files.push({ path: file.path, op: file.op, at: file.ts });
    }
  }

  calls.sort((a, b) => b.at.localeCompare(a.at));
  thoughts.sort((a, b) => b.at.localeCompare(a.at));
  const latestFiles = new Map<string, TrailFile>();
  for (const file of [...files].sort((a, b) => b.at.localeCompare(a.at))) {
    if (!latestFiles.has(file.path)) latestFiles.set(file.path, file);
  }

  const live = runs.some(
    (run) => run.status === "running" || run.status === "queued" || run.status === "awaiting_approval",
  );

  return (
    <div className="page">
      {live ? <LiveRefresh intervalMs={2000} /> : null}
      <div className="composer-bar">
        <Link href="/agents" className="glass-pill">
          <ArrowLeft size={16} aria-hidden />
          Agents
        </Link>
        <span className="trail-kicker">
          <ScrollText size={14} aria-hidden />
          Trail · {model}
        </span>
        <StatusBadge status={agent.status} />
        <div className="composer-bar-end">
          <Link href={`/agents/${agent.id}`} className="glass-pill">
            <Bot size={15} aria-hidden />
            Agent profile
          </Link>
          <Link href={`/agents/${agent.id}/console`} className="glass-pill">
            <FolderOpen size={15} aria-hidden />
            Files
          </Link>
        </div>
      </div>
      <div className="page-top" style={{ marginTop: 24 }}>
        <h1>{agent.name}</h1>
      </div>
      <AgentTrail
        agentName={agent.name}
        calls={calls.slice(0, 40)}
        thoughts={thoughts.slice(0, 24)}
        files={[...latestFiles.values()].slice(0, 24)}
      />
    </div>
  );
}
