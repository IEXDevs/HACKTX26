import { resolveActionEffects } from "@agent-os/core";
import { ActionPolicy } from "@/components/relay/action-policy";
import { getWorkspaceContext } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PolicyPage() {
  const { workspace } = await getWorkspaceContext();
  return (
    <div className="page">
      <div className="page-top">
        <h1>Policy</h1>
      </div>
      <p className="lede">
        You set what every agent in this workspace may do. Changes apply on the next tool call.
      </p>
      <ActionPolicy initial={resolveActionEffects(workspace.actionEffects)} />
    </div>
  );
}
