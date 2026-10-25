import { TOOL_MANIFEST } from "@agent-os/core";
import { ConnectorsView } from "@/components/relay/connectors";
import { relativeTime } from "@/lib/format";
import { requireWorkspace, listConnectors } from "@/lib/queries";
import { listKbDocuments, searchKnowledgeBase } from "@/lib/runtime/kb";

export const dynamic = "force-dynamic";

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const workspace = await requireWorkspace();
  const [{ connectors, credentials }, documents, hits] = await Promise.all([
    listConnectors(workspace.id),
    listKbDocuments(workspace.id),
    query.length > 1 ? searchKnowledgeBase(workspace.id, query, { topK: 5 }) : Promise.resolve([]),
  ]);
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
      hits={hits.map((h) => ({
        id: h.id,
        title: h.title,
        snippet: h.snippet,
      }))}
      documents={documents.map((d) => ({
        id: d.id,
        title: d.title,
        dataClass: d.dataClass,
        added: relativeTime(d.createdAt),
        characters: Number(d.characters),
      }))}
      tools={TOOL_MANIFEST.map((t) => ({ name: t.name, label: t.label, risk: t.risk }))}
    />
  );
}
