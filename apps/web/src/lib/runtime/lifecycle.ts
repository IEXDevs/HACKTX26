/**
 * Agent lifecycle inside one run. Pure: no database, no app imports.
 *
 * An agent has work while its own step loop runs. It also has work while any
 * agent it delegated to (directly or further down) still runs. When it has no
 * work left and nothing below it does, it terminates. Terminating is reported
 * once; an agent that is delegated to again later starts a new lifetime.
 */

export type AgentOutcome = "done" | "failed";

export class AgentLifecycle {
  readonly #active = new Map<string, number>();
  readonly #delegator = new Map<string, string | null>();
  readonly #outcome = new Map<string, AgentOutcome>();
  readonly #terminated = new Set<string>();

  /** An agent starts working, delegated by `delegatorId` (null for the root). */
  start(agentId: string, delegatorId: string | null): void {
    this.#terminated.delete(agentId);
    if (!this.#delegator.has(agentId)) this.#delegator.set(agentId, delegatorId);
    this.#active.set(agentId, (this.#active.get(agentId) ?? 0) + 1);
  }

  /**
   * An agent's own work ends. Returns the agents that terminate as a result,
   * in order: the agent itself, then any delegator that was only waiting on it.
   */
  finish(agentId: string, outcome: AgentOutcome): string[] {
    this.#active.set(agentId, Math.max(0, (this.#active.get(agentId) ?? 0) - 1));
    // A failure sticks for this lifetime; a later success does not hide it.
    if (outcome === "failed" || !this.#outcome.has(agentId)) this.#outcome.set(agentId, outcome);
    const ended: string[] = [];
    let current: string | null | undefined = agentId;
    while (current && this.#settles(current)) {
      this.#terminated.add(current);
      ended.push(current);
      current = this.#delegator.get(current);
    }
    return ended;
  }

  outcome(agentId: string): AgentOutcome {
    return this.#outcome.get(agentId) ?? "done";
  }

  /** Agents that started but never terminated, e.g. after a crash. */
  open(): string[] {
    return [...this.#delegator.keys()].filter((id) => !this.#terminated.has(id));
  }

  /** Force-terminate everything still open. Returns what was ended. */
  terminateAll(outcome: AgentOutcome): string[] {
    const ended = this.open();
    for (const id of ended) {
      this.#active.set(id, 0);
      if (!this.#outcome.has(id) || outcome === "failed") this.#outcome.set(id, outcome);
      this.#terminated.add(id);
    }
    return ended;
  }

  isTerminated(agentId: string): boolean {
    return this.#terminated.has(agentId);
  }

  #settles(agentId: string): boolean {
    if (this.#terminated.has(agentId)) return false;
    if ((this.#active.get(agentId) ?? 0) > 0) return false;
    return !this.#busyBelow(agentId);
  }

  /** Is any agent that this one delegated to, at any depth, still working? */
  #busyBelow(agentId: string): boolean {
    for (const [id, count] of this.#active) {
      if (count === 0 || id === agentId) continue;
      const seen = new Set<string>();
      let up = this.#delegator.get(id);
      while (up && !seen.has(up)) {
        if (up === agentId) return true;
        seen.add(up);
        up = this.#delegator.get(up);
      }
    }
    return false;
  }
}
