import type { GraphAgent } from "./graph-data";
import { BUILTIN_MOTIVATOR } from "./builtin-motivator";

export const MOTIVATOR_PREVIEW_ID = BUILTIN_MOTIVATOR.id;

/** Built into every workflow. It is not a selectable library agent or a child slot. */
export function motivatorPreview(lead: GraphAgent): GraphAgent {
  return { ...lead, id: MOTIVATOR_PREVIEW_ID, name: "Motivator", role: "motivator", kind: "motivator", parentAgentId: null,
    placeholder: false, summary: BUILTIN_MOTIVATOR.summary,
    model: lead.model || "Selected with the orchestrator", complexity: "standard", tools: [], grants: [], rank: "peer", trailHref: "", consoleHref: "" };
}
