import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VoiceLine } from "@/components/voice/voice-line";
import { getAgent, requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** An agent of the current workspace that can still take calls, or null. */
async function lineAgent(id: string) {
  const [workspace, agent] = await Promise.all([requireWorkspace(), getAgent(id)]);
  if (!agent || agent.workspaceId !== workspace.id || agent.status === "archived") return null;
  return agent;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const agent = await lineAgent(id);
  return { title: agent ? `${agent.name} · Voice line` : "Voice line" };
}

export default async function VoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await lineAgent(id);
  if (!agent) notFound();
  return <VoiceLine agentId={agent.id} agentName={agent.name} />;
}
