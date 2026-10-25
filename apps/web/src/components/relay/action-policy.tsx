"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ACTION_POLICIES,
  type PolicyEffect,
} from "@agent-os/core";

const verdictWord: Record<PolicyEffect, string> = {
  allow: "Allowed",
  allow_with_log: "Allowed and logged",
  require_approval: "Asks you first",
  deny: "Blocked",
};

const OPTIONS: PolicyEffect[] = ["allow", "allow_with_log", "require_approval", "deny"];

export function ActionPolicy({
  initial,
}: {
  initial: Record<string, PolicyEffect>;
}) {
  const router = useRouter();
  const [effects, setEffects] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function setEffect(resource: string, effect: PolicyEffect) {
    const previous = effects[resource];
    setEffects((current) => ({ ...current, [resource]: effect }));
    setBusy(resource);
    setError("");
    try {
      const response = await fetch("/api/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effects: { [resource]: effect } }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error ?? "The change was not saved.");
      if (value.effects) setEffects(value.effects);
      router.refresh();
    } catch (cause) {
      setEffects((current) => ({ ...current, [resource]: previous }));
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h2>What agents may do</h2>
      <p className="wf-meta" style={{ marginBottom: 12 }}>
        Access levels apply to every agent. Pick Allowed, Allowed and logged, Asks you first, or
        Blocked for each action.
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      <ul className="list">
        {ACTION_POLICIES.map((row) => {
          const effect = effects[row.resource] ?? "require_approval";
          return (
            <li key={row.resource}>
              <div>
                <b>{row.action}</b>
              </div>
              <label className="sr-only" htmlFor={`policy-${row.resource}`}>
                Access level for {row.action}
              </label>
              <select
                id={`policy-${row.resource}`}
                className={`select verdict-select verdict ${effect}`}
                value={effect}
                disabled={busy === row.resource}
                onChange={(event) => void setEffect(row.resource, event.target.value as PolicyEffect)}
              >
                {OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {verdictWord[option]}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
