import { resolveActionEffects } from "@agent-os/core";
import { ActionPolicy } from "@/components/relay/action-policy";
import { getWorkspaceContext } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { workspace } = await getWorkspaceContext();
  return (
    <div className="page">
      <div className="page-top">
        <h1>Settings</h1>
      </div>
      <ActionPolicy initial={resolveActionEffects(workspace.actionEffects)} />
    </div>
  );
}
