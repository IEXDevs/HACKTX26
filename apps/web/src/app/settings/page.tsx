import Link from "next/link";
import { AppearanceControl } from "@/components/shell/theme-switch";

export default function SettingsPage() {
  return (
    <div className="page">
      <div className="page-top">
        <h1>Settings</h1>
      </div>

      <section className="section" style={{ marginTop: 0 }}>
        <h2>Appearance</h2>
        <p className="wf-meta" style={{ marginBottom: 14 }}>
          Light, dark, or match your device. Saved in the browser, not the workspace.
        </p>
        <AppearanceControl />
      </section>

      <section className="section">
        <h2>Privacy</h2>
        <p className="wf-meta" style={{ marginBottom: 12 }}>
          What this workspace stores, where traces go, and what leaves the server.
        </p>
        <Link href="/policy" className="btn">
          Open privacy policy
        </Link>
      </section>
    </div>
  );
}
