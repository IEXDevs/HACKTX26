"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound, Loader2, ShieldQuestion, XCircle } from "lucide-react";
import { Tag, buttonClass } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/format";

export interface CredentialView {
  id: string;
  name: string;
  connectorName: string | null;
  hint: string;
  scopes: string[];
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  rotatedAt: string | null;
}

interface VerifyResult {
  ok: boolean;
  algorithm: string;
  plaintextBytes: number;
  plaintextReturned: boolean;
  checkedAt: string;
}

export function CredentialVault({ credentials }: { credentials: CredentialView[] }) {
  const [results, setResults] = useState<Record<string, VerifyResult>>({});
  const [busy, setBusy] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function verify(id: string) {
    // Track busy per credential so concurrent verifies don't clear each
    // other's spinner state.
    setBusy((current) => (current.includes(id) ? current : [...current, id]));
    setError(null);
    try {
      const response = await fetch(`/api/credentials/${id}/verify`, { method: "POST" });
      const payload = (await response.json()) as VerifyResult & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `Verification failed (HTTP ${response.status}).`);
        return;
      }
      setResults((current) => ({ ...current, [id]: payload }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy((current) => current.filter((value) => value !== id));
    }
  }

  return (
    <div>
      {error ? (
        <p
          role="alert"
          className="mx-3 mt-3 rounded-xs border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger"
        >
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-line">
        {credentials.map((credential) => {
          const result = results[credential.id];
          const verifying = busy.includes(credential.id);
          return (
            <li key={credential.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <KeyRound size={11} className="shrink-0 text-ink-4" />
                    <span className="truncate text-[11.5px] text-ink">{credential.name}</span>
                  </div>
                  <div className="mono mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] text-ink-4">
                    <span>{credential.connectorName ?? "unscoped"}</span>
                    <span className="text-line-strong">·</span>
                    <span className="text-ink-3">{credential.hint}</span>
                    <span className="text-line-strong">·</span>
                    <span>{credential.createdBy}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => verify(credential.id)}
                  disabled={verifying}
                  className={buttonClass("outline", "sm")}
                >
                  {verifying ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <ShieldQuestion size={10} />
                  )}
                  Verify
                </button>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {credential.scopes.map((scope) => (
                  <span
                    key={scope}
                    className="mono rounded-xs border border-line px-1 py-0.5 text-[8.5px] text-ink-3"
                  >
                    {scope}
                  </span>
                ))}
                <span className="mono ml-auto text-[8.5px] text-ink-4">
                  used {relativeTime(credential.lastUsedAt)} · rotated{" "}
                  {relativeTime(credential.rotatedAt)}
                </span>
              </div>

              {result ? (
                <div
                  className={
                    result.ok
                      ? "animate-fade-up mt-2 flex flex-wrap items-center gap-1.5 rounded-xs border border-ok/30 bg-ok/5 px-2 py-1.5"
                      : "animate-fade-up mt-2 flex flex-wrap items-center gap-1.5 rounded-xs border border-danger/30 bg-danger/10 px-2 py-1.5"
                  }
                >
                  {result.ok ? (
                    <CheckCircle2 size={10} className="text-ok" />
                  ) : (
                    <XCircle size={10} className="text-danger" />
                  )}
                  <span
                    className={
                      result.ok
                        ? "mono text-[9px] text-ok"
                        : "mono text-[9px] text-danger"
                    }
                  >
                    {result.ok
                      ? `${result.algorithm} auth tag valid · ${result.plaintextBytes} bytes decrypted in-process · plaintext returned: ${String(result.plaintextReturned)}`
                      : "decryption failed — ciphertext or auth tag is corrupt"}
                  </span>
                  <Tag tone="muted" className="ml-auto">
                    {relativeTime(result.checkedAt)}
                  </Tag>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-4 py-2.5">
        <p className="text-[10px] leading-relaxed text-ink-4">
          Secrets are sealed with AES-256-GCM before insert. Verify decrypts in-process to
          prove the tag, then throws the plaintext away — it never reaches the client, the
          trace, or the model.
        </p>
      </div>
    </div>
  );
}
