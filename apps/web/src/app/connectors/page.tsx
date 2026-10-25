import { getSessionUser } from "@/lib/auth";
import { ConnectorsView } from "@/components/relay/connectors";
import { listConnectorViews, operatorIdFor } from "@/lib/connectors";
import { relativeTime } from "@/lib/format";
import { getWorkspaceUser, listConnectors } from "@/lib/queries";
import { listKbDocuments, searchKnowledgeBase } from "@/lib/runtime/kb";

export const dynamic = "force-dynamic";

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; linked?: string; doc?: string }>;
}) {
  const { q, linked, doc } = await searchParams;
  const query = q?.trim() ?? "";
  const docQuery = doc?.trim() ?? "";
  const { workspace, user } = await getWorkspaceUser();
  const session = await getSessionUser();
  const [
    { connectors, composio, serpapi },
    { connectors: registered, credentials },
    documents,
    hits,
  ] = await Promise.all([
    listConnectorViews({
      workspaceId: workspace.id,
      userId: operatorIdFor(session?.id, user?.id),
      query,
    }),
    listConnectors(workspace.id),
    listKbDocuments(workspace.id),
    docQuery.length > 1
      ? searchKnowledgeBase(workspace.id, docQuery, { topK: 5 })
      : Promise.resolve([]),
  ]);
  const name = new Map(registered.map((c) => [c.id, c.name]));

  return (
    <ConnectorsView
      initial={connectors}
      query={query}
      composio={composio}
      serpapi={serpapi}
      linked={linked}
      keys={credentials.map((k) => ({
        id: k.id,
        name: k.name,
        hint: k.hint,
        connector: k.connectorId ? (name.get(k.connectorId) ?? null) : null,
        used: k.lastUsedAt ? relativeTime(k.lastUsedAt) : null,
      }))}
      docQuery={docQuery}
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
    />
  );
}
