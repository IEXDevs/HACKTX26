"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUp, Check, LoaderCircle, Search, X } from "@/components/icons";
import { applyAttachments, type ComposerAttachment } from "@/lib/composer-attachments";
import { ComposerAttach, ComposerChips } from "./composer-attach";
import { GraphSpace } from "@/components/graph/graph-space";
import type { V2 } from "@/components/graph/graph-geometry";
import { WORKFLOW_MODES, type WorkflowMode } from "@/lib/workflow-mode";
import { removeSlotBranch, selectionGraph, WorkflowSelectionSchema, type LibraryAgent, type WorkflowSlot } from "@/lib/workflow-selection";

const NO_TASKS: [] = [];
const FIRST_SLOT: WorkflowSlot = { id: "lead", parentId: null, agentId: null };

export function WorkflowBuilder({ mode, library, onBack }: {
  mode: WorkflowMode;
  library: LibraryAgent[];
  onBack: () => void;
}) {
  const router = useRouter();
  const [slots, setSlots] = useState<WorkflowSlot[]>([FIRST_SLOT]);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerId, setPickerId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const positions = useRef<Record<string, V2>>({});
  const serial = useRef(0);
  const graph = useMemo(() => selectionGraph(slots, library), [slots, library]);
  const locked = busy || thinking;
  const ready = slots.every((slot) => slot.agentId);
  const pickerSlot = slots.find((slot) => slot.id === pickerId);
  const visible = library.filter((agent) => `${agent.name} ${agent.summary}`.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!pickerId) return;
    const previous = document.activeElement;
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [pickerId]);

  function openPicker(id: string) {
    if (locked) return;
    setSelectedId(id);
    setSearch("");
    setPickerId(id);
  }

  function canAddChild(id: string) {
    let depth = 0;
    let slot = slots.find((item) => item.id === id);
    while (slot?.parentId) {
      const parentId = slot.parentId;
      depth++;
      slot = slots.find((item) => item.id === parentId);
    }
    return Boolean(slot) && depth < 3 && slots.length < 25;
  }

  function addChild(parentId: string | null) {
    if (locked || !parentId || !canAddChild(parentId)) return;
    const id = `slot-${serial.current++}`;
    setSlots((current) => [...current, { id, parentId, agentId: null }]);
    setSelectedId(id);
  }

  function choose(agent: LibraryAgent) {
    setSlots((current) => current.map((slot) => slot.id === pickerId ? { ...slot, agentId: agent.id } : slot));
    if (!pickerSlot?.parentId && !name.trim()) setName(`${agent.name} workflow`.slice(0, 64));
    setPickerId(null);
  }

  async function save() {
    if (!ready || locked) return;
    const selection = WorkflowSelectionSchema.safeParse({ name: name.trim() || "Untitled workflow", mode, nodes: slots, goal: goal || undefined });
    if (!selection.success) { setError("Choose an agent for every node before saving."); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workflows", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection.data),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "The workflow could not be saved.");
      try {
        const saved = Object.fromEntries((value.nodes as Array<{ id: string; agentId: string }>).flatMap((node) =>
          positions.current[node.id] ? [[node.agentId, positions.current[node.id]]] : []));
        localStorage.setItem(`astronom.graph.${value.workflowId}`, JSON.stringify({ spacing: 1, positions: saved }));
      } catch { /* The workflow also works when browser storage is disabled. */ }
      router.push(`/workflows/${value.workflowId}`);
      router.refresh();
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  }

  async function arrange() {
    if (!prompt.trim() || locked) return;
    setThinking(true);
    setError("");
    try {
      const response = await fetch("/api/workflows/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, prompt: applyAttachments(prompt.trim(), attachments), current: JSON.stringify({ name, goal, nodes: slots }) }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "The workflow could not be arranged.");
      const selection = WorkflowSelectionSchema.parse(value);
      setSlots(selection.nodes);
      setName(selection.name);
      setGoal(selection.goal || prompt.trim());
      setSelectedId(null);
      setPrompt("");
    } catch (cause) { setError((cause as Error).message); }
    finally { setThinking(false); }
  }

  return (
    <div className="page wf-studio">
      <header className="wf-studio-toolbar">
        <button className="icon-btn" aria-label="Workflow modes" title="Workflow modes" onClick={onBack} disabled={locked}><ArrowLeft size={17} aria-hidden /></button>
        <span className="wf-studio-mode">{WORKFLOW_MODES.find((item) => item.id === mode)?.name}</span>
        <input className="wf-studio-name" aria-label="Workflow name" placeholder="Untitled workflow" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} disabled={locked} />
        <button className="btn primary" onClick={() => void save()} disabled={!ready || locked}>
          {busy && <LoaderCircle size={14} className="animate-spin" aria-hidden />}Save
        </button>
      </header>
      <div className="wf-studio-canvas">
        <GraphSpace agents={graph} tasks={NO_TASKS}
          onLayoutChange={(next) => { positions.current = next; }}
          editor={{ selectedId, onSelect: openPicker, onAdd: mode === "dynamic" ? undefined : addChild, canAddChild, disabled: locked }} />
        {mode !== "manual" && <form className="wf-studio-command" onSubmit={(event) => { event.preventDefault(); void arrange(); }}>
          <ComposerAttach attachments={attachments} onChange={setAttachments} />
          <input aria-label="Describe the workflow" placeholder={mode === "automatic" ? "Describe a tree for your agents…" : "Describe the task for the lead agent…"} value={prompt} maxLength={3000} onChange={(event) => setPrompt(event.target.value)} disabled={locked} />
          <button type="submit" className="wf-studio-send" aria-label="Arrange agents" disabled={!prompt.trim() || locked}>{thinking ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={16} />}</button>
          <ComposerChips attachments={attachments} onRemove={(item) => setAttachments(attachments.filter((row) => row !== item))} />
        </form>}
        {(error || thinking) && <div className="wf-studio-status" role={error ? "alert" : "status"}>
          <span>{error || "Choosing agents…"}</span>{error && <button className="icon-btn" aria-label="Dismiss error" onClick={() => setError("")}><X size={13} /></button>}
        </div>}
      </div>
      {pickerId && <div className="wf-agent-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerId(null); }}>
        <section className="wf-agent-picker" role="dialog" aria-modal="true" aria-labelledby="agent-picker-title" onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); setPickerId(null); }
          if (event.key === "Tab") {
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input,a[href]")];
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
          <header><h2 id="agent-picker-title">Choose agent</h2><button className="icon-btn" aria-label="Close agent picker" onClick={() => setPickerId(null)}><X size={16} /></button></header>
          <label className="wf-agent-search"><Search size={15} aria-hidden /><input autoFocus aria-label="Search existing agents" placeholder="Search agents" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="wf-agent-options">
            {visible.map((agent) => <button key={agent.id} className="wf-agent-option" onClick={() => choose(agent)} aria-label={`Use ${agent.name}`}>
              <span><b>{agent.name}</b><span>{agent.summary}</span></span>{pickerSlot?.agentId === agent.id && <Check size={16} aria-hidden />}
            </button>)}
            {!visible.length && <p className="wf-picker-empty">{library.length ? "No agents match that search." : <>No agents yet. <Link href="/agents/new">Add one in Agents.</Link></>}</p>}
          </div>
          {pickerSlot?.agentId && <footer><button className="link-btn" onClick={() => { setSlots((current) => removeSlotBranch(current, pickerId)); setPickerId(null); setSelectedId(null); }}>Remove from workflow</button></footer>}
        </section>
      </div>}
    </div>
  );
}
