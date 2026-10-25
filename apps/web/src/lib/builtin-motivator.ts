/** Public profile for the peer that the runtime starts with each orchestrator. */
export const BUILTIN_MOTIVATOR = {
  id: "builtin-motivator",
  name: "Motivator",
  summary: "Reviews blockers and proposed exits. Sends the orchestrator back to useful work, or requests user input when only the user can unblock it.",
} as const;
