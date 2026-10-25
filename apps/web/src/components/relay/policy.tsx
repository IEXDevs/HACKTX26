"use client";

import Link from "next/link";
import { Check } from "@/components/icons";
import { AdvancedSwitch, useAdvanced } from "./advanced";

export interface RuleRow {
  action: string;
  verdict: "allow" | "allow_with_log" | "require_approval" | "deny";
  reason: string;
}
export interface AuditRow {
  id: string;
  who: string;
  what: string;
  when: string;
}
export interface ModelRow {
  id: string;
  label: string;
  denied: boolean;
  allowed: boolean[];
}

const verdictWord: Record<RuleRow["verdict"], string> = {
  allow: "Allowed",
  allow_with_log: "Allowed and logged",
  require_approval: "Asks you first",
  deny: "Blocked",
};

export function PolicyView({
  rules,
  audit,
  models,
  dataClasses,
}: {
  rules: RuleRow[];
  audit: AuditRow[];
  models: ModelRow[];
  dataClasses: string[];
}) {
  const [advanced, toggleAdvanced] = useAdvanced();
  return (
    <div className="page narrow">
      <div className="page-top">
        <h1>Policy</h1>
        <div className="page-actions">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
          <Link href="/billing" className="btn">
            Spending limits
          </Link>
        </div>
      </div>

      <section>
        <h2>What agents may do</h2>
        <ul className="list">
          {rules.map((r) => (
            <li key={r.action}>
              <div>
                <b>{r.action}</b>
                {advanced && <small>{r.reason}</small>}
              </div>
              <span className={`verdict ${r.verdict}`}>{verdictWord[r.verdict]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2>Recent changes</h2>
        {audit.length ? (
          <ul className="list">
            {(advanced ? audit : audit.slice(0, 8)).map((a) => (
              <li key={a.id}>
                <div>
                  <b>{a.what}</b>
                  <small>
                    {a.who} · {a.when}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No changes yet.</p>
        )}
      </section>

      {advanced && (
        <section className="section">
          <h2>Which models may see which data</h2>
          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  {dataClasses.map((d) => (
                    <th key={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.label}
                      {m.denied && <span className="tag">Turned off</span>}
                    </td>
                    {m.allowed.map((ok, i) => (
                      <td key={i} aria-label={ok ? "Allowed" : "Not allowed"}>
                        {ok && !m.denied ? (
                          <Check size={14} strokeWidth={2.2} style={{ color: "var(--green)" }} />
                        ) : (
                          <span style={{ color: "var(--faint)" }}>—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
