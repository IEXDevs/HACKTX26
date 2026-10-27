import { listAccountKeys, requireAssetAccount } from "@/lib/account-assets";
import { ConnectorsView } from "@/components/relay/connectors";
import { listConnectorViews } from "@/lib/connectors";
import { listKbDocuments } from "@/lib/runtime/kb";

export const dynamic = "force-dynamic";

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; linked?: string }>;
}) {
  const { q, linked } = await searchParams;
  const query = q?.trim() ?? "";
  const account = await requireAssetAccount();
  const [
    { connectors, composio, serpapi },
    keys,
    documents,
  ] = await Promise.all([
    listConnectorViews({
      workspaceId: account.workspaceId,
      userId: account.accountId,
      query,
    }),
    listAccountKeys(account),
    listKbDocuments(account.workspaceId, account.accountId),
  ]);

  return (
    <ConnectorsView
      initial={connectors}
      query={query}
      composio={composio}
      serpapi={serpapi}
      linked={linked}
      keys={keys.map((k) => ({
        id: k.id,
        name: k.name,
        purpose: k.purpose,
      }))}
      documents={documents.map((d) => ({
        id: d.id,
        title: d.title,
      }))}
    />
  );
}
