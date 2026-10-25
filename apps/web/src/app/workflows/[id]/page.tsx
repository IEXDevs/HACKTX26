import { notFound, redirect } from "next/navigation";
import { RunPage } from "@/components/relay/run-page";
import { Workflow } from "@/components/relay/workflow";
import { env } from "@/lib/env";
import { workflowGraph } from "@/lib/graph-data";
import { getAgentDetail, requireWorkspace } from "@/lib/queries";
import { isContextStub, WorkspaceContextFile } from "@/lib/runtime/workspace-context";
import { workflowView } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const [{ id }, { run }] = await Promise.all([params, searchParams]);
  const workspace = await requireWorkspace();
  const workflow = await workflowView(workspace.id, id);
  if (!workflow) {
    // Team members are not workflows of their own; show them as agents.
    if (await getAgentDetail(id)) redirect(`/agents/${id}`);
    notFound();
  }
  const runId = run && workflow.runs.some((r) => r.id === run) ? run : null;
  const contextFile = new WorkspaceContextFile(env.sandboxRoot, workspace.id);
  const content = contextFile.ensure();
  return (
    <Workflow
      key={runId ?? "draft"}
      workflow={workflow}
      graph={await workflowGraph(workspace.id, id)}
      context={{ content, stub: isContextStub(content) }}
      runId={runId}
      run={runId ? await RunPage({ runId, embedded: true }) : null}
    />
  );
}
