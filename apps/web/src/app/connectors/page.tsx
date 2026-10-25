import { TOOL_MANIFEST } from "@agent-os/core";
import { ConnectorsView } from "@/components/relay/connectors";
import { relativeTime } from "@/lib/format";
import { requireWorkspace, listConnectors } from "@/lib/queries";
import { KB_DOCUMENTS, searchKnowledgeBase } from "@/lib/runtime/kb";

export const dynamic = "force-dynamic";

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const workspace = await requireWorkspace();
  const { connectors, credentials } = await listConnectors(workspace.id);
  const name = new Map(connectors.map((c) => [c.id, c.name]));

  return (
    <ConnectorsView
      connectors={connectors.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        description: c.description,
        status: c.status,
        synced: c.lastSyncAt ? relativeTime(c.lastSyncAt) : null,
      }))}
      keys={credentials.map((k) => ({
        id: k.id,
        name: k.name,
        hint: k.hint,
        connector: k.connectorId ? (name.get(k.connectorId) ?? null) : null,
        used: k.lastUsedAt ? relativeTime(k.lastUsedAt) : null,
      }))}
      query={query}
      hits={(query.length > 1 ? searchKnowledgeBase(query, 5) : []).map((h) => ({
        id: h.id,
        title: h.title,
        snippet: h.snippet,
      }))}
      documents={KB_DOCUMENTS.length}
      tools={TOOL_MANIFEST.map((t) => ({ name: t.name, label: t.label, risk: t.risk }))}
    />
  );
}
