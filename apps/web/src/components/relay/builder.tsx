"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Globe,
  LoaderCircle,
  Mic,
  ShieldCheck,
  Square,
  Users,
  Video,
} from "@/components/icons";
import { VoiceSphere, type VoiceSphereState } from "@/components/voice/voice-sphere";
import { useLiveSession, type LiveStatus, type LiveToolCall } from "@/components/voice/use-live-session";
import { CHECK_MAX_USD, RED_TEAM_CATEGORIES } from "@/lib/loop/redteam-limits";
import { DraftSchema, type BuilderDraft } from "@/lib/runtime/builder-parse";
import { plainText } from "@/lib/plain-text";
import { RichText } from "./rich-text";
import { WORKFLOW_MODES, type WorkflowMode } from "@/lib/workflow-mode";

export interface BuilderTemplate {
  id: string;
  name: string;
  description: string;
  outcome: string;
}
interface DraftApp {
  slug: string;
  name: string;
  linked: boolean;
}
interface Message {
  id: string;
  from: "you" | "builder";
  text: string;
  draft?: BuilderDraft;
  apps?: DraftApp[];
  searches?: string[];
}
/** A partly spoken line, shown until the speaker finishes it. */
interface SpokenLine {
  from: "you" | "builder";
  text: string;
}
type Check =
  | { state: "running"; done: number; total: number }
  | { state: "finished"; findings: number };

/**
 * Live agent builder. Typed replies come from Muse through POST /api/builder;
 * "Talk to Astro" holds the same conversation by voice over Gemini Live, and
 * a workflow video becomes the first message. Publish creates exactly the
 * drafted team through POST /api/agents/custom and activates it.
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
    [thinking, setThinking] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [spoken, setSpoken] = useState<SpokenLine[]>([]),
    // Set after publishing: offers a red-team check, then follows it.
    [published, setPublished] = useState<{ id: string; name: string } | null>(null),
    [check, setCheck] = useState<Check | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  // Voice callbacks outlive renders; they read the latest state through these.
  const latest = useRef({ messages, draft });
  latest.current = { messages, draft };
  const linkedApps = useRef<Map<string, string> | null>(null);

  const id = () => `m${nextId.current++}`;
  const append = (message: Omit<Message, "id">) => setMessages((all) => [...all, { ...message, id: id() }]);

  useEffect(() => {
    if (messages.length || spoken.length) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, spoken, thinking]);

  const live = useLiveSession({
    start: async () => {
      const response = await fetch("/api/gemini/astro", { method: "POST" });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error ?? "Astro could not start.");
      return value as { token: string; model: string };
    },
    onToolCall: (call) => astroTool(call),
    onTranscript: (line) => {
      const from = line.role === "user" ? "you" : "builder";
      if (line.final) {
        setSpoken((lines) => lines.filter((l) => l.from !== from));
        if (line.text.trim()) append({ from, text: line.text.trim() });
      } else {
        setSpoken((lines) => [...lines.filter((l) => l.from !== from), { from, text: line.text }]);
      }
    },
    onClose: () => setSpoken([]),
  });
  const talking = !["idle", "error"].includes(live.status);

  async function send(text = input.trim(), afterVideo = false) {
    if (!text || (thinking && !afterVideo)) return;
    const history: Message[] = [...messages, { id: id(), from: "you", text }];
    setMessages(history);
    setInput("");
    setThinking("Thinking…");
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
        id: id(),
        from: "builder",
        text: value.reply || "Here is the agent.",
        draft: value.draft ?? undefined,
        apps: value.apps ?? [],
        searches: (value.searches ?? []).map((s: { query: string }) => s.query),
      };
      if (workflowMode === "dynamic" && reply.draft) reply.draft = { ...reply.draft, workers: [] };
      setMessages([...history, reply]);
      if (reply.draft) setDraft(reply.draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setThinking(null);
    }
  }

  async function uploadVideo(file: File) {
    if (thinking) return;
    setThinking("Watching the video…");
    setError("");
    try {
      const form = new FormData();
      form.append("video", file);
      const response = await fetch("/api/builder/video", { method: "POST", body: form });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error ?? "The video could not be read.");
      await send(value.description, true);
    } catch (e) {
      setError((e as Error).message);
      setThinking(null);
    }
  }

  /** Link status for a draft's apps, from the Connectors list. Read once per call. */
  async function appsFor(slugs: string[]): Promise<DraftApp[]> {
    if (!linkedApps.current) {
      const response = await fetch("/api/connectors");
      const value = (await response.json().catch(() => ({}))) as {
        connectors?: { slug: string; name: string; connected: boolean }[];
      };
      linkedApps.current = new Map((value.connectors ?? []).map((c) => [c.slug, c.connected ? c.name : ""]));
    }
    return slugs.map((slug) => {
      const name = linkedApps.current?.get(slug);
      return { slug, name: name || slug, linked: Boolean(name) };
    });
  }

  /** Astro's functions. Whatever is returned is what Astro hears back. */
  async function astroTool(call: LiveToolCall): Promise<unknown> {
    if (call.name === "propose_agent") {
      const parsed = DraftSchema.safeParse(call.args);
      if (!parsed.success) {
        return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
      }
      const next = workflowMode === "dynamic" ? { ...parsed.data, workers: [] } : parsed.data;
      const apps = await appsFor(next.apps ?? []);
      setDraft(next);
      append({ from: "builder", text: "", draft: next, apps });
      const missing = apps.filter((app) => !app.linked).map((app) => app.name);
      return missing.length
        ? `The draft is on screen. These apps are not linked yet: ${missing.join(", ")}. Ask the person to link them on the Connectors page before it runs.`
        : "The draft is on screen.";
    }
    if (call.name === "search_web") {
      const response = await fetch("/api/builder/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: String(call.args.query ?? "") }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) return { error: value.error ?? "Search failed." };
      return (value.hits as { title: string; url: string; snippet: string }[])
        .map((hit) => `${hit.title} (${hit.url}): ${hit.snippet}`)
        .join("\n");
    }
    if (call.name === "build_agent") {
      const current = latest.current.draft;
      if (!current) return { error: "There is no draft yet. Propose one first." };
      const created = await create(true, { checkNow: true });
      return created
        ? `${current.name} is created and published. Its red-team check is running now and takes about a minute.`
        : { error: "The agent was not created." };
    }
    return { error: `Unknown function ${call.name}.` };
  }

  async function create(publish: boolean, options: { checkNow?: boolean } = {}): Promise<boolean> {
    const current = latest.current.draft;
    if (!current) return false;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/agents/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: current, canSpawnSubagents, proposeTemplates, workflowMode,
          conversation: latest.current.messages
            .filter((message) => message.text)
            .map((message) => ({ role: message.from === "you" ? "user" : "assistant", content: message.text })),
        }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "The agent was not created.");
      if (publish) {
        for (const agentId of value.agentIds as string[]) {
          const activate = await fetch(`/api/agents/${agentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "active" }),
          });
          if (!activate.ok) {
            const problem = await activate.json().catch(() => ({}));
            throw new Error(problem.error ?? "The agent was created but not published.");
          }
        }
        const agent = { id: value.orchestratorId as string, name: current.name };
        setPublished(agent);
        if (options.checkNow && !workflow) await startCheck(agent.id);
        return true;
      }
      router.push(`/${workflow ? "workflows" : "agents"}/${value.orchestratorId}`);
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function startCheck(agentId: string) {
    const response = await fetch(`/api/agents/${agentId}/redteam`, { method: "POST" });
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw new Error(value.error ?? "The red-team tests did not start.");
    }
    setCheck({ state: "running", done: 0, total: RED_TEAM_CATEGORIES.length });
  }

  // Follow a running check until it reports.
  useEffect(() => {
    if (!published || check?.state !== "running") return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/agents/${published.id}/redteam`);
      const value = await response.json().catch(() => null);
      if (value?.state === "running") setCheck({ state: "running", done: value.probesDone, total: value.probesTotal });
      if (value?.state === "finished") setCheck({ state: "finished", findings: value.findings });
    }, 2500);
    return () => clearInterval(timer);
  }, [published, check?.state]);

  async function finish(redTeam: boolean) {
    if (!published) return;
    setBusy(true);
    setError("");
    try {
      if (redTeam && !workflow) {
        await startCheck(published.id);
        setBusy(false);
        return;
      }
      if (redTeam) await startCheck(published.id);
      // The workflow page shows the test runs as they happen.
      router.push(`/${redTeam || workflow ? "workflows" : "agents"}/${published.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function toggleAstro() {
    if (talking) {
      live.disconnect();
      return;
    }
    setError("");
    void live.connect();
  }

  const chatting = messages.length > 0 || spoken.length > 0;
  const latestDraft = [...messages].reverse().find((m) => m.draft)?.id;
  const sphere: VoiceSphereState = talking ? sphereState(live.status) : thinking ? "thinking" : "idle";
  const voiceError = live.error;
  const tools = (
    <div className="composer-tools">
      <button type="button" className={"glass-pill" + (talking ? " on" : "")} onClick={toggleAstro}>
        {talking ? <Square size={14} aria-hidden /> : <Mic size={16} aria-hidden />}
        {talking ? "Stop talking" : "Talk to Astro"}
      </button>
      <button
        type="button"
        className="glass-pill"
        disabled={Boolean(thinking)}
        onClick={() => videoInput.current?.click()}
      >
        <Video size={16} aria-hidden />
        Upload video
      </button>
      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadVideo(file);
        }}
      />
    </div>
  );

  return (
    <div className={"composer" + (chatting ? " chatting" : "")}>
      <div className="composer-bar">
        {onBack ? (
          <button className="glass-pill" onClick={onBack}><ArrowLeft size={16} aria-hidden />Workflow modes</button>
        ) : (
          <Link href="/agents" className="glass-pill"><ArrowLeft size={16} />Agents</Link>
        )}
        <div className="composer-bar-end">
          <button className="glass-pill" disabled={busy || Boolean(thinking) || !draft} onClick={() => void create(false)}>
            Save draft
          </button>
        </div>
      </div>

      {chatting ? (
        <>
          {talking && (
            <div className="composer-voice" aria-hidden>
              <VoiceSphere state={sphere} inputLevel={live.inputLevel} outputLevel={live.outputLevel} size={120} />
            </div>
          )}
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
                    {m.searches && m.searches.length > 0 && (
                      <p className="chat-searched">
                        <Globe size={13} aria-hidden /> Searched for {m.searches.map((q) => `“${q}”`).join(", ")}
                      </p>
                    )}
                    {m.text && <RichText text={m.text} />}
                    {m.draft && m.id === latestDraft && (
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
                        {m.apps && m.apps.length > 0 && (
                          <ul className="draft-apps">
                            {m.apps.map((app) => (
                              <li key={app.slug}>
                                {app.linked ? (
                                  <span>{app.name}</span>
                                ) : (
                                  <Link href="/connectors" target="_blank" rel="noopener">
                                    Link {app.name} <ArrowUpRight size={12} aria-hidden />
                                  </Link>
                                )}
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
                        <button className="composer-send" disabled={busy || Boolean(thinking)} onClick={() => void create(true)}>
                          {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={16} />}
                          {workflow ? "Publish workflow" : "Publish agent"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
            {spoken.map((line) =>
              line.from === "you" ? (
                <div key={`s-${line.from}`} className="chat-you spoken">
                  <p>{line.text}</p>
                </div>
              ) : (
                <div key={`s-${line.from}`} className="chat-builder spoken">
                  <span className="chat-avatar" aria-hidden />
                  <p>{line.text}</p>
                </div>
              ),
            )}
            {thinking && (
              <div className="chat-builder">
                <span className="chat-avatar" aria-hidden />
                <p className="chat-thinking">{thinking}</p>
              </div>
            )}
            {(error || voiceError) && <p className="error-text">{error || voiceError}</p>}
            <div ref={end} className="chat-end" />
          </div>
          <div className="composer-dock">
            <Box
              value={input}
              onChange={setInput}
              onSubmit={() => void send()}
              label="Reply to the builder"
              placeholder={talking ? "Or type…" : "Reply…"}
              submit="Send"
              disabled={Boolean(thinking) || !input.trim()}
              busy={Boolean(thinking)}
              autoFocus
            />
            {tools}
          </div>
        </>
      ) : (
        <>
          <div className="composer-hero">
            <VoiceSphere
              state={sphere}
              inputLevel={talking ? live.inputLevel : undefined}
              outputLevel={talking ? live.outputLevel : undefined}
              size={180}
              className="composer-sphere"
            />
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
            disabled={Boolean(thinking) || !input.trim()}
            busy={Boolean(thinking)}
          />
          {tools}
          {thinking && <p className="chat-thinking composer-status">{thinking}</p>}
          {(error || voiceError) && <p className="error-text" style={{ marginTop: 12 }}>{error || voiceError}</p>}
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
            {check?.state === "running" ? (
              <>
                <div className="toolbar">
                  <h2 id="redteam-title">Testing {published.name}</h2>
                </div>
                <p className="redteam-copy">
                  <LoaderCircle size={15} className="animate-spin" aria-hidden /> Red-team test {Math.min(check.done + 1, check.total)} of {check.total}
                </p>
              </>
            ) : check?.state === "finished" ? (
              <>
                <div className="toolbar">
                  <h2 id="redteam-title">
                    {check.findings === 0
                      ? `${published.name} passed its red-team tests`
                      : `The red team found ${check.findings} ${check.findings === 1 ? "problem" : "problems"}`}
                  </h2>
                </div>
                <div className="dialog-actions">
                  {check.findings > 0 ? (
                    <Link href="/security" className="btn">See what failed</Link>
                  ) : (
                    <a href={`/voice/${published.id}`} target="_blank" rel="noopener" className="btn">
                      Open voice line <ArrowUpRight size={14} aria-hidden />
                    </a>
                  )}
                  <Link href={`/agents/${published.id}`} className="btn primary">Open agent</Link>
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function sphereState(status: LiveStatus): VoiceSphereState {
  return status === "error" ? "idle" : status;
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
      <button type="submit" className="composer-send" disabled={disabled}>
        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={16} />}
        {submit}
      </button>
    </form>
  );
}
