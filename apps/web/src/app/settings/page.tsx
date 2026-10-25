import Link from "next/link";
import { resolveActionEffects } from "@agent-os/core";
import { ActionPolicy } from "@/components/relay/action-policy";
import { AppearanceControl } from "@/components/shell/theme-switch";
import { requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const workspace = await requireWorkspace();
  return (
    <div className="page">
      <div className="page-top">
        <h1>Settings</h1>
      </div>

      <section className="section" style={{ marginTop: 0 }}>
        <h2>Appearance</h2>
        <AppearanceControl />
      </section>

      <ActionPolicy initial={resolveActionEffects(workspace.actionEffects)} initialApprovalMode={workspace.approvalMode} />

      <section className="section">
        <h2>Privacy</h2>
        <Link href="/policy" className="btn">
          Open privacy policy
        </Link>
      </section>
    </div>
  );
}
