import Link from "next/link";
import { ArrowLeft } from "@/components/icons";
import { RichText } from "@/components/relay/rich-text";
import { BUILTIN_MOTIVATOR } from "@/lib/builtin-motivator";
import { requireWorkspace } from "@/lib/queries";
import { MOTIVATOR_SYSTEM } from "@/lib/runtime/motivator";

export const dynamic = "force-dynamic";

export default async function MotivatorPage() {
  await requireWorkspace();
  return (
    <div className="composer">
      <div className="composer-bar">
        <Link href="/agents/library" className="glass-pill"><ArrowLeft size={16} aria-hidden />Agents</Link>
      </div>
      <div className="agent-head">
        <span className="composer-orb" aria-hidden />
        <div className="agent-copy">
          <h1 className="composer-title">{BUILTIN_MOTIVATOR.name} <span className="tag">Built-in</span></h1>
          <p className="composer-summary">{BUILTIN_MOTIVATOR.summary}</p>
        </div>
      </div>
      <dl className="spec-strip">
        <div><dt>Role</dt><dd>Orchestrator peer</dd></div>
        <div><dt>Model</dt><dd>Matches the orchestrator</dd></div>
        <div><dt>Budget</dt><dd>Shared run budget</dd></div>
        <div><dt>Starts</dt><dd>With every orchestrator</dd></div>
      </dl>
      <section>
        <h2>How it works</h2>
        <div className="card">
          <p>The orchestrator reports its blocker, attempts, evidence, and remaining options when it gets stuck. The motivator reviews that report and gives concrete next actions. It also checks proposed final answers.</p>
          <p>When only the user can unblock the goal, it pauses the run and shows a question on Agents. The same run resumes after the answer. It respects user stops and the run’s budget and step limits.</p>
          <p>With Approve for me enabled in Settings, it also reviews permission requests. It can approve the proposed action, reject it, or ask you to decide. It cannot add tools or override blocked actions.</p>
          <p>Motivator is required for each workflow. It runs alongside the orchestrator and cannot be archived or started on its own. Open a workflow map or run log to see its activity.</p>
        </div>
      </section>
      <section className="section">
        <h2>Instructions</h2>
        <div className="card"><RichText text={MOTIVATOR_SYSTEM.split("\n").join("\n\n")} /></div>
      </section>
    </div>
  );
}
