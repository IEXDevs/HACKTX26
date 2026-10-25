"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUp, LoaderCircle, ShieldCheck, Users } from "@/components/icons";
import { applyAttachments, type ComposerAttachment } from "@/lib/composer-attachments";
import { CHECK_MAX_USD, RED_TEAM_CATEGORIES } from "@/lib/loop/redteam-limits";
import type { BuilderDraft } from "@/lib/runtime/builder-parse";
import { plainText } from "@/lib/plain-text";
import { RichText } from "./rich-text";
import { ComposerAttach, ComposerChips } from "./composer-attach";
import { WORKFLOW_MODES, type WorkflowMode } from "@/lib/workflow-mode";

export interface BuilderTemplate {
  id: string;
  name: string;
  description: string;
  outcome: string;
}
interface Message {
  id: string;
  from: "you" | "builder";
  text: string;
  draft?: BuilderDraft;
}

/**
 * Live agent builder. Every reply comes from Muse through POST /api/builder.
 * Publish creates exactly the drafted team through POST /api/agents/custom
 * and activates it.
 */
export function Builder({ templates, workflowMode, onBack }: {
  templates: BuilderTemplate[];
  workflowMode?: Exclude<WorkflowMode, "manual">;
  onBack?: () => void;
}) {
  const router = useRouter();
  const workflow = Boolean(workflowMode);
  const mode = WORKFLOW_MODES.find((option) => option.id === workflowMode);
  const [input, setInput] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState<BuilderDraft | null>(null),
    [canSpawnSubagents, setCanSpawnSubagents] = useState(true),
    [proposeTemplates, setProposeTemplates] = useState(false),
    [thinking, setThinking] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    // Set after publishing: offers a red-team check before leaving.
    [published, setPublished] = useState<{ id: string; name: string } | null>(null),
    [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  async function send() {
    const raw = input.trim();
    if (!raw || thinking) return;
    const text = applyAttachments(raw, attachments);
    const history: Message[] = [...messages, { id: `y${messages.length}`, from: "you", text }];
    setMessages(history);
    setInput("");
    setThinking(true);
    setError("");
    try {
      const response = await fetch("/api/builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowMode,
          messages: history.map((m) => ({
            role: m.from === "you" ? "user" : "assistant",
            // Give the model its earlier drafts so edits build on them.
            content: m.draft ? JSON.stringify({ reply: m.text, draft: m.draft }) : m.text,
          })),
        }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "The builder did not answer.");
      const reply: Message = {
        id: `b${history.length}`,
        from: "builder",
        text: value.reply || "Here is the agent.",
        draft: value.draft ?? undefined,
      };
      if (workflowMode === "dynamic" && reply.draft) reply.draft = { ...reply.draft, workers: [] };
      setMessages([...history, reply]);
      if (reply.draft) setDraft(reply.draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setThinking(false);
    }
  }

  async function create(publish: boolean) {
    if (!draft || thinking) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/agents/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, canSpawnSubagents, proposeTemplates, workflowMode,
          conversation: messages.map((message) => ({ role: message.from === "you" ? "user" : "assistant", content: message.text })),
        }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "The agent was not created.");
      if (publish) {
        for (const id of value.agentIds as string[]) {
          const activate = await fetch(`/api/agents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "active" }),
          });
          if (!activate.ok) {
            const problem = await activate.json().catch(() => ({}));
            throw new Error(problem.error ?? "The agent was created but not published.");
          }
        }
      }
      if (publish) {
        setPublished({ id: value.orchestratorId, name: draft.name });
        return;
      }
      router.push(`/${workflow ? "workflows" : "agents"}/${value.orchestratorId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish(redTeam: boolean) {
    if (!published) return;
    setBusy(true);
    setError("");
    try {
      if (redTeam) {
        const response = await fetch(`/api/agents/${published.id}/redteam`, { method: "POST" });
        if (!response.ok) {
          const value = await response.json().catch(() => ({}));
          throw new Error(value.error ?? "The red-team tests did not start.");
        }
      }
      // The workflow page shows the test runs as they happen.
      router.push(`/${redTeam || workflow ? "workflows" : "agents"}/${published.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const chatting = messages.length > 0;
  const latest = [...messages].reverse().find((m) => m.draft)?.id;
  return (
    <div className={"composer" + (chatting ? " chatting" : "")}>
      <div className="composer-bar">
        {onBack ? (
          <button className="glass-pill" onClick={onBack}><ArrowLeft size={16} aria-hidden />Workflow modes</button>
        ) : (
          <Link href="/agents" className="glass-pill"><ArrowLeft size={16} />Agents</Link>
        )}
        <div className="composer-bar-end">
          <button className="glass-pill" disabled={busy || thinking || !draft} onClick={() => void create(false)}>
            Save draft
          </button>
        </div>
      </div>

      {chatting ? (
        <>
          <div className="chat" aria-live="polite">
            {messages.map((m) =>
              m.from === "you" ? (
                <div key={m.id} className="chat-you">
                  <p>{m.text}</p>
                </div>
              ) : (
                <div key={m.id} className="chat-builder">
                  <span className="chat-avatar" aria-hidden />
                  <div>
                    <RichText text={m.text} />
                    {m.draft && m.id === latest && (
                      <div className="draft-card">
                        <span className="draft-card-label">{workflow ? `${mode?.name} workflow draft` : "Agent draft"}</span>
                        <b>{m.draft.name}</b>
                        <span className="draft-card-role">{m.draft.summary}</span>
                        <RichText text={m.draft.instructions} />
                        {m.draft.workers.length > 0 && (
                          <ul className="draft-team">
                            {m.draft.workers.map((w) => (
                              <li key={w.name}>
                                <Users size={14} />
                                <span>
                                  <b>{w.name}</b> {plainText(w.instructions)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {workflow ? <p>{mode?.description}</p> : <div className="draft-toggles">
                          <label>
                            <input
                              type="checkbox"
                              checked={canSpawnSubagents}
                              onChange={(event) => setCanSpawnSubagents(event.target.checked)}
                            />
                            Dynamic subagents
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={proposeTemplates}
                              onChange={(event) => setProposeTemplates(event.target.checked)}
                            />
                            Propose child templates
                          </label>
                        </div>}
                        <button className="composer-send" disabled={busy || thinking} onClick={() => void create(true)}>
                          {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={16} />}
                          {workflow ? "Publish workflow" : "Publish agent"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
            {thinking && (
              <div className="chat-builder">
                <span className="chat-avatar" aria-hidden />
                <p className="chat-thinking">Thinking…</p>
              </div>
            )}
            {error && <p className="error-text">{error}</p>}
            <div ref={end} className="chat-end" />
          </div>
          <div className="composer-dock">
            <Box
              value={input}
              onChange={setInput}
              onSubmit={() => void send()}
              label="Reply to the builder"
              placeholder="Reply…"
              submit="Send"
              disabled={thinking || !input.trim()}
              busy={thinking}
              autoFocus
              attachments={attachments}
              onAttachments={setAttachments}
            />
          </div>
        </>
      ) : (
        <>
          <div className="composer-hero">
            <span className="orb-stage" aria-hidden>
              <span className="composer-orb" />
              <i className="orb-spark" />
              <i className="orb-spark" />
              <i className="orb-spark" />
              <i className="orb-spark" />
              <i className="orb-spark" />
            </span>
            <h1 className="composer-title">{workflow ? `${mode?.name} workflow` : "Create agent"}</h1>
            {mode && <p className="workflow-mode-copy">{mode.description}</p>}
          </div>
          <Box
            value={input}
            onChange={setInput}
            onSubmit={() => void send()}
            label={workflow ? "Describe the workflow" : "Describe the agent"}
            placeholder={workflow ? "Describe what this workflow should do…" : "Describe what this agent should do…"}
            submit="Start"
            disabled={thinking || !input.trim()}
            busy={thinking}
            attachments={attachments}
            onAttachments={setAttachments}
          />
          {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
          <div className="composer-templates">
            {templates.slice(0, 6).map((t) => (
              <button key={t.id} className="composer-card" onClick={() => setInput(t.description)}>
                <span className="composer-card-top">
                  <span className="composer-card-icon" aria-hidden>
                    <Users size={16} />
                  </span>
                  <span className="composer-card-tag">Start from this</span>
                </span>
                <b>{t.name}</b>
                <span className="composer-card-text">{t.outcome}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {published && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="redteam-title">
            <div className="toolbar">
              <h2 id="redteam-title">Run red-team tests on {published.name}?</h2>
            </div>
            <p className="redteam-copy">
              The red team sends {published.name} {RED_TEAM_CATEGORIES.length} labeled test attacks, such
              as hidden instructions and fake credentials, and records any that work so you can fix them.
            </p>
            <div className="redteam-warning" role="note">
              <ShieldCheck size={18} aria-hidden />
              <p>
                This uses tokens, up to about ${CHECK_MAX_USD.toFixed(2)}, but it improves the agent&apos;s safety
                significantly.
              </p>
            </div>
            {error && <p className="error-text">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => void finish(false)}>
                No
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void finish(true)}>
                {busy && <LoaderCircle size={15} className="animate-spin" aria-hidden />}
                Yes, run tests
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Box({
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
  submit,
  disabled,
  busy,
  autoFocus = false,
  attachments,
  onAttachments,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder: string;
  submit: string;
  disabled: boolean;
  busy: boolean;
  autoFocus?: boolean;
  attachments: ComposerAttachment[];
  onAttachments: (next: ComposerAttachment[]) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);
  // Grow downward with the text, up to a limit.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);
  return (
    <form
      className="composer-box"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit();
      }}
    >
      <label className="composer-field">
        <span className="sr-only">{label}</span>
        <textarea
          ref={box}
          rows={1}
          placeholder={placeholder}
          maxLength={3000}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !disabled) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </label>
      <div className="composer-tools">
        <ComposerAttach attachments={attachments} onChange={onAttachments} />
        <ComposerChips
          attachments={attachments}
          onRemove={(item) => onAttachments(attachments.filter((row) => row !== item))}
        />
        <button type="submit" className="composer-send" disabled={disabled}>
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          {submit}
        </button>
      </div>
    </form>
  );
}
