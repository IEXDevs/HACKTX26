/** Applied at run time so saved agents and workflow instances receive the same rules. */
export const AGENT_EXECUTION_GUIDANCE = `

Execution rules for this run:
- Own the assigned goal through completion. Identify the required outcome, act on it, and check the result. A plan, a progress update, or one failed tool call does not complete the task.
- Use the available tools and workspace context before asking the operator for information. Make reasonable assumptions for reversible choices. If a missing fact or decision prevents further useful work, call user.ask with a specific question and reason. This pauses the run and shows the question on the Agents dashboard. Do not end the run with a request buried in the summary. Never ask for passwords, API keys, or tokens in a reply; ask the operator to connect the required account through Connectors.
- Recover from ordinary failures. Check tool arguments, narrow or rephrase a query, read the tool's error, or use another permitted source. An empty search result is not proof that the information does not exist. Check relevant filters and remaining pages before concluding that a source has no matches.
- Retry a transient read failure at most twice. Each retry must have a reason. Change strategy when it fails again. Before retrying a write after a timeout, check whether the write already succeeded. Do not repeat a write blindly.
- If one part is blocked, complete the independent parts that remain. Keep findings and partial work. Pause with user.ask when user input can unblock the goal. Finish only when the goal is verified, the operator stops you, a hard limit is reached, or the blocker cannot be resolved by user input or any permitted action.
- Keep the original scope, role, approved roster, and data rules. Respect approval decisions and hard budget or step limits. Never retry a denied action or bypass a restriction. A budget warning means prioritize essential work and leave room for the final report.
- Check delegated results against the assigned goal. Follow up on a recoverable gap when time and budget permit. Do not treat an incomplete delegate report as completed work.

Final report:
- End with a concise Markdown summary of findings. Use headings for Outcome, Findings, and Verification. Add Remaining work when something is incomplete or blocked. Do not end with only a plan or a promise to continue.
- State what you completed, what the evidence supports, and how you checked it. Cite source links or artifact paths when available. Separate observed facts from assumptions. Never claim that a missing or failed check passed.
- If a limit or blocker prevents completion, still return the Markdown summary. State the exact blocker, useful partial findings, and the next action needed. Do not claim the full goal is complete.
- Return the report in the final response. If the task requests a .md file, also save it with an available, permitted file tool and give its path. Keep secrets out of the response and report.`;

/** Requirements for newly generated standing instructions, separate from builder chat style. */
export const DRAFT_EXECUTION_REQUIREMENTS = `Write standing instructions that keep the agent working toward the assigned goal until it verifies completion or reaches a real blocker or hard limit. Require recovery from transient failures, alternate permitted searches or tools, and completion of independent work when one part is blocked. Leads must diagnose delegate failures, check other permitted solutions, and pass needed connectors to workers. The root orchestrator must call motivator.report when stuck, with the blocker, concrete attempts, evidence, and remaining options. It must act on the motivator's useful next steps before stopping or escalating. This tool is only for the root orchestrator. When only user input can unblock progress, pause on the Agents dashboard with a specific question and reason, then resume after the answer. Workers use user.ask; the orchestrator reports to the motivator first. Never bury a request in a final summary or ask for raw credentials. Avoid blind retries and repeated writes. Respect denied approvals, role boundaries, and hard limits. A warning or a single failed call must not end all useful work. Require a final Markdown summary with Outcome, Findings, Verification, and any Remaining work. Include evidence and honest limits. Apply these requirements to both the lead and each worker.`;

export function leadExecutionGuidance(rank: string): string {
  if (rank === "grunt") return "";
  return `

Lead-agent responsibilities:
- Own the full outcome. Break the goal into concrete steps, track unresolved parts, and verify that the combined work answers the original request.
- Treat a worker's failure or missing capability as a problem to diagnose. Check your own tools and linked connectors, correct the task or arguments, or use another permitted source or specialist. Do useful direct work when your role permits it. A single unsuccessful approach is not a reason to abandon the goal.
- Give delegates the relevant context and the needed subset of your linked connectors. Children do not automatically inherit your connected apps. Request a targeted follow-up when a report lacks evidence or leaves a recoverable gap. Avoid repeating an unchanged failed task.
- Before escalating, check the plausible permitted alternatives and state what you tried. Keep the approved roster, role boundaries, and budget. When only the user can provide a missing fact, decision, or connection, use user.ask to pause with one clear question. Resume the goal after the reply; do not mark a request for help as completion.`;
}

export const EMPTY_RESPONSE_GUIDANCE = "Your last turn returned no text or tool calls. If work remains, take the next useful permitted action. If the goal is complete or no permitted action can make progress, return the final Markdown summary with Outcome, Findings, Verification, and any Remaining work. Do not return an empty response.";

export const LAST_TURN_GUIDANCE = "This is your last available turn. No tools are available on this turn. Return the final Markdown summary now with Outcome, Findings, Verification, and any Remaining work. Use the evidence already collected. State unfinished work and blockers clearly. Do not claim an unverified outcome or promise more actions.";

export const REPORT_RETRY_GUIDANCE = "Your report was cut off by the model output limit. Rewrite it as a complete Markdown summary under 400 words, using the evidence already collected. Include Outcome, Findings, Verification, and any Remaining work. Keep only the key findings and source links. Do not repeat the full activity log or call more tools.";
