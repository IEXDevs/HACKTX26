import {
  DEFAULT_POLICY_RULES,
  MODEL_CATALOG,
  evaluatePermission,
  type DataClass,
  type Risk,
} from "@agent-os/core";
import { PolicyView } from "@/components/relay/policy";
import { relativeTime } from "@/lib/format";
import { getWorkspaceContext, listAuditLog } from "@/lib/queries";

export const dynamic = "force-dynamic";

const DATA_CLASSES: DataClass[] = ["public", "internal", "confidential", "restricted"];

// Common actions, checked against the live permission engine.
const ACTIONS: Array<{
  action: string;
  resource: string;
  risk: Risk;
  scopes: Array<"read" | "write" | "execute" | "net" | "secret">;
}> = [
  { action: "Read files", resource: "fs.read", risk: "low", scopes: ["read"] },
  { action: "Write files", resource: "fs.write", risk: "medium", scopes: ["write"] },
  { action: "Reach outside websites", resource: "http.fetch", risk: "medium", scopes: ["net", "read"] },
  { action: "Run shell commands", resource: "shell.exec", risk: "high", scopes: ["execute"] },
  { action: "Use stored credentials", resource: "secret.use", risk: "critical", scopes: ["secret"] },
  { action: "Deploy to production", resource: "cli:prod-deploy", risk: "high", scopes: ["execute"] },
];

const ACTION_WORDS: Record<string, string> = {
  "agent.created_from_template": "Created an agent",
  "agent.created": "Created an agent",
  "agent.published": "Published an agent",
  "agent.active": "Turned an agent on",
  "agent.paused": "Paused an agent",
  "agent.draft": "Moved an agent to draft",
  "agent.archived": "Archived an agent",
  "approval.approved": "Approved a request",
  "approval.denied": "Denied a request",
  "approval.expired": "A request expired",
  "budget.updated": "Changed a spending limit",
  "connector.degraded": "A connector had trouble",
  "credential.rotated": "Replaced a saved key",
  "credential.verified": "Checked a saved key",
  "eval.run": "Ran a test suite",
  "finding.auto_healed": "Turned an issue into a guardrail",
  "finding.triaged": "Updated a security issue",
  "grant.added": "Gave an agent a permission",
  "policy.updated": "Changed a policy",
  "prompt_block.created": "Added a rule",
  "prompt_block.updated": "Changed a rule",
  "sandbox.remove": "Deleted a file in a workspace",
  "sandbox.write": "Edited a file in a workspace",
};
/** Plain words for an audit action; unknown ones fall back to their name. */
function plain(action: string): string {
  if (ACTION_WORDS[action]) return ACTION_WORDS[action];
  const text = action.replace(/[._]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default async function PolicyPage() {
  const { workspace } = await getWorkspaceContext();
  const audit = await listAuditLog(workspace.id, 40);
  const denied = new Set(workspace.deniedModelIds);

  return (
    <PolicyView
      rules={ACTIONS.map(({ action, ...request }) => {
        const decision = evaluatePermission(request, DEFAULT_POLICY_RULES);
        return { action, verdict: decision.effect, reason: decision.reason };
      })}
      audit={audit.map((a) => ({
        id: a.id,
        who: a.actor,
        what: plain(a.action),
        when: relativeTime(a.at),
      }))}
      models={MODEL_CATALOG.map((m) => ({
        id: m.id,
        label: m.label,
        denied: denied.has(m.id),
        allowed: DATA_CLASSES.map((d) => m.allowedDataClasses.includes(d)),
      }))}
      dataClasses={DATA_CLASSES}
    />
  );
}
