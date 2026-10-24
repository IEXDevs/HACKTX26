'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  Layers,
  Loader2,
  Maximize,
  Network,
  Pause,
  Play,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  defaultTree,
  descendants,
  executionOrder,
  layoutTree,
  modeDescriptions,
  modeLabels,
  treeDefinitionSchema,
  type AgentTree,
  type TreeNode,
} from '@/lib/agent-tree';
import './agent-trees.css';

const exampleTask =
  'Plan a welcoming meetup near UT Austin for 80 people within a $3,000 budget. Research venues, use community preferences, compare options, and flag details that need confirmation.';
const terminalStates = ['succeeded', 'failed', 'cancelled', 'rejected'];
async function request(path: string, options: RequestInit = {}) {
  const response = await fetch('/v1/' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Request failed');
  return data;
}
function useRun(id: string | null) {
  const [run, setRun] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setRun(null);
    setError('');
    if (!id) return;
    let disposed = false;
    let inflight = false;
    let source: EventSource | null = null;
    let interval: ReturnType<typeof setInterval> | undefined;
    const refresh = async () => {
      if (disposed || inflight) return;
      inflight = true;
      try {
        const result = await request('runs/' + id);
        if (!disposed) {
          setRun(result);
          setError('');
          if (terminalStates.includes(result.status)) {
            source?.close();
            if (interval) clearInterval(interval);
          }
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      } finally {
        inflight = false;
      }
    };
    source = new EventSource('/v1/runs/' + id + '/events?stream=true');
    source.addEventListener('execution', () => void refresh());
    source.addEventListener('done', () => {
      source?.close();
      void refresh();
    });
    void refresh();
    interval = setInterval(() => void refresh(), 1200);
    return () => {
      disposed = true;
      source?.close();
      if (interval) clearInterval(interval);
    };
  }, [id]);
  return { run, error };
}
function nodeState(node: TreeNode, run: any, previewId?: string) {
  if (previewId === node.id) return 'preview';
  if (!run) return 'planned';
  const step = run.steps.find((s: any) => s.id === 'agent_' + node.id);
  const failed = run.steps.find((s: any) => s.input?.nodeId === node.id && s.status === 'failed');
  if (failed) return 'failed';
  if (step?.status === 'succeeded') return 'succeeded';
  if (run.status === 'cancelled') return 'cancelled';
  if (step) return step.status;
  if (run.steps.some((s: any) => s.input?.nodeId === node.id && s.status === 'running'))
    return 'running';
  if (node.id === 'user' && !terminalStates.includes(run.status)) return 'coordinating';
  if (node.id === 'user' && run.status === 'failed') return 'failed';
  return run.status === 'cancelled' ? 'cancelled' : 'planned';
}
const stateLabel: Record<string, string> = {
  planned: 'Planned',
  preview: 'Preview',
  running: 'Working',
  coordinating: 'Coordinating',
  succeeded: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
function Badge({ value }: { value: string }) {
  return (
    <span className={'at-badge ' + value}>
      <i />
      {stateLabel[value] || value.replaceAll('_', ' ')}
    </span>
  );
}
function ModelIcon({ provider }: { provider: string }) {
  return provider === 'gemini' ? <Sparkles size={12} /> : <span className="at-meta-mark">∞</span>;
}

export function AgentTreeWorkspace({
  agents,
  mode,
  initialAgentId,
  onChanged,
  onOpenRun,
}: {
  agents: any[];
  mode: string;
  initialAgentId?: string | null;
  onChanged: () => Promise<void>;
  onOpenRun: (id: string) => void;
}) {
  const models = useMemo(
    () => ({
      muse: agents[0]?.draft.coordinatorModel || 'muse-spark-1.3',
      gemini: agents[0]?.draft.extractionModel || 'gemini-2.5-flash',
    }),
    [agents],
  );
  const [tree, setTree] = useState<AgentTree>(() => defaultTree(models));
  const [selected, setSelected] = useState('user');
  const [name, setName] = useState('Community operations team');
  const [task, setTask] = useState(exampleTask);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [intent, setIntent] = useState<'manual' | 'automatic'>('manual');
  const [complexity, setComplexity] = useState<'auto' | 'simple' | 'standard' | 'complex'>('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(true);
  const [planId, setPlanId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(true);
  const appliedInitial = useRef<string | null>(null);
  const appliedPlan = useRef<string | null>(null);
  const publishKey = useRef<string | null>(null);
  const pendingLaunch = useRef<{ id: string; versionId: string; version: number } | null>(null);
  const planning = useRun(planId);
  const execution = useRun(runId);
  useEffect(() => {
    if (!initialAgentId || appliedInitial.current === initialAgentId) return;
    const agent = agents.find((a) => a.id === initialAgentId && a.draft.tree);
    if (!agent) return;
    appliedInitial.current = initialAgentId;
    loadAgent(agent, true);
  }, [initialAgentId, agents]);
  useEffect(() => {
    const run = planning.run;
    if (!run || appliedPlan.current === run.id) return;
    if (run.status === 'succeeded') {
      const parsed = treeDefinitionSchema.safeParse(run.output?.tree);
      if (parsed.success) {
        setTree(parsed.data);
        setSelected('user');
        setDirty(true);
        setPreview(true);
        publishKey.current = null;
        pendingLaunch.current = null;
        setMessage(
          run.mode === 'fixture'
            ? 'Fixture planner generated a proposed team. Review it before publishing.'
            : 'The planning agent proposed this team. Review its roles and permissions.',
        );
      } else setError('The planner returned an invalid tree. Your current tree was kept.');
      appliedPlan.current = run.id;
      setBusy(false);
    } else if (terminalStates.includes(run.status)) {
      setError(run.error || 'Planning stopped');
      appliedPlan.current = run.id;
      setBusy(false);
    }
  }, [planning.run]);
  function loadAgent(agent: any, restoreRun = false) {
    setTree(structuredClone(agent.draft.tree));
    setName(agent.name);
    setTask(agent.draft.treeTask || exampleTask);
    setAgentId(agent.id);
    setSelected('user');
    setRunId(restoreRun ? new URLSearchParams(window.location.search).get('treeRun') : null);
    setPlanId(null);
    setDirty(false);
    setError('');
    setMessage('Loaded saved tree. Existing versions remain immutable.');
    publishKey.current = null;
    pendingLaunch.current = null;
    if (!restoreRun) history.replaceState(null, '', '?view=trees&tree=' + agent.id);
  }
  function changeTree(next: AgentTree) {
    setTree(next);
    setDirty(true);
    setMessage('');
    publishKey.current = null;
    pendingLaunch.current = null;
  }
  function updateNode(changes: Partial<TreeNode>) {
    changeTree({
      ...tree,
      nodes: tree.nodes.map((n) => (n.id === selected ? { ...n, ...changes } : n)),
    });
  }
  function addChild(parentId: string) {
    if (tree.nodes.length >= 9) {
      setError('This bounded prototype supports up to nine agent nodes.');
      return;
    }
    const nodeId = 'agent_' + crypto.randomUUID().slice(0, 8);
    const parent = tree.nodes.find((n) => n.id === parentId)!;
    changeTree({
      ...tree,
      nodes: [
        ...tree.nodes,
        {
          id: nodeId,
          parentId,
          name: 'New specialist',
          instructions:
            'Solve a focused part of the task. Return useful findings and flag missing information.',
          provider: parent.provider,
          model: parent.model,
          mode: 'reason',
          tools: [],
        },
      ],
    });
    setSelected(nodeId);
    setError('');
  }
  async function generate() {
    setBusy(true);
    setError('');
    setMessage('');
    setRunId(null);
    setPlanId(null);
    setPreview(false);
    try {
      const root = tree.nodes.find((n) => n.id === 'user')!;
      const run = await request('trees/plan', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ task, complexity, provider: root.provider, model: root.model }),
      });
      setPlanId(run.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function save(publish: boolean, start = false) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload = { name, task, tree, ...(agentId ? { agentId } : {}), publish };
      const key = publishKey.current || crypto.randomUUID();
      publishKey.current = key;
      const saved =
        start && pendingLaunch.current
          ? pendingLaunch.current
          : await request('trees', {
              method: 'POST',
              headers: { 'Idempotency-Key': key },
              body: JSON.stringify(payload),
            });
      setAgentId(saved.id);
      setDirty(false);
      publishKey.current = null;
      if (start) pendingLaunch.current = saved;
      history.replaceState(null, '', '?view=trees&tree=' + saved.id);
      await onChanged();
      if (start) {
        const result = await request('runs', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'tree-run-' + saved.versionId },
          body: JSON.stringify({ versionId: saved.versionId, input: { brief: task } }),
        });
        setRunId(result.id);
        pendingLaunch.current = null;
        setPreview(false);
        setSelected('user');
        history.replaceState(null, '', '?view=trees&tree=' + saved.id + '&treeRun=' + result.id);
        setMessage('Published v' + saved.version + '. This run pins that exact tree.');
      } else
        setMessage(
          publish ? 'Published immutable version v' + saved.version + '.' : 'Tree draft saved.',
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const displayedTree: AgentTree = execution.run?.config.tree || tree;
  const displayedTask = execution.run?.input.brief || task;
  const selectedNode = displayedTree.nodes.find((n) => n.id === selected) || displayedTree.nodes[0];
  const valid = treeDefinitionSchema.safeParse(tree);
  const running = !!execution.run && !terminalStates.includes(execution.run.status);
  const treeAgents = agents.filter((a) => a.draft.tree);
  return (
    <div className="at-workspace">
      <div className="page-heading at-page-heading">
        <div>
          <div className="eyebrow">
            <span /> MULTI-AGENT WORKSPACE
          </div>
          <h1>A team for every task.</h1>
          <p>Build the team. Follow the handoffs. Open any agent to see what it knows.</p>
        </div>
        <div className="at-page-actions">
          <span className="at-guard">
            <ShieldCheck size={14} /> Read tools only
          </span>
          <button onClick={() => void save(false)} disabled={busy || !!runId || !valid.success}>
            <Save size={14} />
            Save draft
          </button>
          <button
            className="primary"
            onClick={() => void save(true, true)}
            disabled={busy || !!runId || !valid.success || task.trim().length < 10 || !name.trim()}
          >
            {busy ? <Loader2 className="spin" size={14} /> : <Play size={14} />}Publish & run
          </button>
        </div>
      </div>
      <div className="at-command-panel">
        <div className="at-builder-tabs">
          <button
            className={intent === 'manual' ? 'active' : ''}
            onClick={() => setIntent('manual')}
          >
            <GitBranch size={15} />
            Manual builder
          </button>
          <button
            className={intent === 'automatic' ? 'active' : ''}
            onClick={() => setIntent('automatic')}
          >
            <Sparkles size={15} />
            Let an agent plan
          </button>
          <span className="at-command-spacer" />
          <label className="at-saved-select">
            <Layers size={13} />
            <select
              aria-label="Saved agent tree"
              value={agentId || ''}
              disabled={busy || !!runId}
              onChange={(e) => {
                const a = treeAgents.find((a) => a.id === e.target.value);
                if (a) loadAgent(a);
                else {
                  setAgentId(null);
                  changeTree(defaultTree(models));
                  setName('New agent team');
                  setSelected('user');
                }
              }}
            >
              <option value="">New agent tree</option>
              {treeAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="at-task-row">
          <span className="at-task-avatar">
            <User size={19} />
          </span>
          <div>
            <label htmlFor="at-task">
              YOUR TASK <span>The root orchestrator owns this brief.</span>
            </label>
            <textarea
              id="at-task"
              aria-label="Task for the agent tree"
              value={runId ? displayedTask : task}
              disabled={!!runId || busy}
              maxLength={15000}
              onChange={(e) => {
                setTask(e.target.value);
                setDirty(true);
                publishKey.current = null;
                pendingLaunch.current = null;
              }}
            />
          </div>
          {intent === 'automatic' ? (
            <div className="at-auto-actions">
              <select
                aria-label="Task complexity"
                value={complexity}
                disabled={busy || !!runId}
                onChange={(e) => setComplexity(e.target.value as typeof complexity)}
              >
                <option value="auto">Auto-detect complexity</option>
                <option value="simple">Simple · focused specialist</option>
                <option value="standard">Standard · specialist team</option>
                <option value="complex">Complex · research & review</option>
              </select>
              <button
                className="primary"
                disabled={busy || !!runId || task.trim().length < 10}
                onClick={() => void generate()}
              >
                {busy ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />}Generate
                agent tree
              </button>
            </div>
          ) : (
            <div className="at-manual-note">
              <Network size={18} />
              <span>
                Select a node to configure it.
                <br />
                Use <b>+</b> to add a child agent.
              </span>
            </div>
          )}
        </div>
        {intent === 'automatic' && (
          <div className="at-planner-note">
            <ShieldCheck size={12} />
            {mode === 'fixture'
              ? 'Fixture planner uses task complexity signals. No planning model is called.'
              : 'The selected root model designs a bounded team. Review the proposal before publishing.'}
            <span>Planning uses 1 test credit.</span>
          </div>
        )}
      </div>
      {(error || execution.error || planning.error) && (
        <div className="alert error" role="alert">
          <XCircle size={16} />
          {error || execution.error || planning.error}
          <button aria-label="Dismiss tree error" onClick={() => setError('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {message && (
        <div className="at-message" role="status">
          <CheckCircle2 size={14} />
          {message}
        </div>
      )}
      {!valid.success && <div className="alert error">{valid.error.issues[0]?.message}</div>}
      {busy && planId && !execution.run && !terminalStates.includes(planning.run?.status) && (
        <div className="at-planning-state">
          <Loader2 size={17} className="spin" />
          <div>
            <b>The architect is sizing your team.</b>
            <span>One durable planning run. Your current tree stays available.</span>
          </div>
          <button onClick={() => onOpenRun(planId)}>
            Inspect planning run <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      {runId && (
        <div className="at-run-strip">
          <span className="at-live-dot" />
          <b>{execution.run ? execution.run.status.replaceAll('_', ' ') : 'Loading execution…'}</b>
          <code>{runId}</code>
          <span>
            {execution.run ? (Number(execution.run.active_ms) / 1000).toFixed(1) + 's active' : ''}
          </span>
          {running && (
            <button
              onClick={async () => {
                try {
                  await request('runs/' + runId + '/cancel', { method: 'POST' });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <X size={13} />
              Cancel run
            </button>
          )}
          <button onClick={() => onOpenRun(runId)}>
            Open in Runs <ArrowUpRight size={13} />
          </button>
          <button
            onClick={() => {
              setRunId(null);
              setPreview(false);
              history.replaceState(null, '', '?view=trees' + (agentId ? '&tree=' + agentId : ''));
            }}
          >
            Back to builder
          </button>
        </div>
      )}
      <div className="at-board">
        <TreeCanvas
          tree={displayedTree}
          selected={selected}
          onSelect={setSelected}
          onAdd={!runId && !busy ? addChild : undefined}
          preview={!runId && preview}
          run={execution.run}
          onPreview={!runId ? () => setPreview(!preview) : undefined}
        />
        <aside className="at-inspector">
          {runId ? (
            <AgentInspector
              node={selectedNode}
              tree={displayedTree}
              task={displayedTask}
              run={execution.run}
            />
          ) : (
            <fieldset className="at-editor-fields" disabled={busy}>
              <NodeEditor
                node={selectedNode}
                tree={tree}
                name={name}
                models={models}
                onName={(v) => {
                  setName(v);
                  setDirty(true);
                  publishKey.current = null;
                  pendingLaunch.current = null;
                }}
                onChange={updateNode}
                onAdd={() => addChild(selectedNode.id)}
                onRemove={() => {
                  const removed = descendants(tree, selectedNode.id);
                  changeTree({ ...tree, nodes: tree.nodes.filter((n) => !removed.has(n.id)) });
                  setSelected('user');
                }}
              />
            </fieldset>
          )}
        </aside>
      </div>
      <div className="at-board-footer">
        <div>
          <span className="at-complexity">
            <Layers size={13} />
            {displayedTree.complexity} complexity
          </span>
          <span>{displayedTree.nodes.length} agents</span>
          <span>
            {displayedTree.nodes.reduce((n, a) => n + a.tools.length, 0)} scoped tool calls
          </span>
          <span>{dirty ? 'Unsaved changes' : 'Saved configuration'}</span>
        </div>
        <span>
          <ShieldCheck size={12} />
          Sequential, bounded execution · parents synthesize after children
        </span>
      </div>
      <div className="at-rationale">
        <Sparkles size={15} />
        <div>
          <b>Why this team?</b>
          <p>{tree.rationale}</p>
        </div>
        {planId && (
          <button onClick={() => onOpenRun(planId)}>
            Planning record <ArrowUpRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function TreeCanvas({
  tree,
  selected,
  onSelect,
  onAdd,
  preview,
  run,
  onPreview,
}: {
  tree: AgentTree;
  selected: string;
  onSelect: (id: string) => void;
  onAdd?: (id: string) => void;
  preview: boolean;
  run: any;
  onPreview?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [frame, setFrame] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutTree(tree), [tree]);
  const order = useMemo(() => executionOrder(tree), [tree]);
  useEffect(() => {
    if (!preview) return;
    const t = setInterval(() => setFrame((v) => v + 1), 1800);
    return () => clearInterval(t);
  }, [preview]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const center = () => {
      element.scrollLeft = Math.max(0, (layout.width * zoom - element.clientWidth) / 2);
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layout.width, zoom]);
  const previewId = preview ? order[frame % order.length]?.id : undefined;
  const completed =
    run?.steps.filter((s: any) => s.kind === 'model' && s.status === 'succeeded' && s.input?.nodeId)
      .length || 0;
  function fit() {
    if (!scroller.current) return;
    setZoom(Math.max(0.5, Math.min(1, (scroller.current.clientWidth - 40) / layout.width)));
    scroller.current.scrollTop = 0;
  }
  return (
    <div className="at-canvas">
      <div className="at-canvas-toolbar">
        <div>
          <span className={'at-signal ' + (run ? 'execution' : preview ? 'preview' : '')}>
            <i />
            {run
              ? 'PERSISTED EXECUTION'
              : preview
                ? 'PREVIEW · SIMULATED TRAFFIC'
                : 'TREE BLUEPRINT'}
          </span>
          {run ? (
            <small>
              {completed}/{tree.nodes.length} agents complete
            </small>
          ) : (
            <small>Configure before you run</small>
          )}
        </div>
        <div className="at-canvas-tools">
          {onPreview && (
            <button
              onClick={onPreview}
              aria-label={preview ? 'Pause flow preview' : 'Play flow preview'}
            >
              {preview ? <Pause size={13} /> : <Play size={13} />}
              <span>{preview ? 'Pause preview' : 'Preview flow'}</span>
            </button>
          )}
          <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.45, z - 0.1))}>
            <ZoomOut size={14} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.3, z + 0.1))}>
            <ZoomIn size={14} />
          </button>
          <button aria-label="Fit agent tree" onClick={fit}>
            <Maximize size={14} />
          </button>
        </div>
      </div>
      <div className="at-canvas-scroll" ref={scroller}>
        <div
          className="at-scaled-space"
          style={{ width: layout.width * zoom, height: layout.height * zoom }}
        >
          <div
            className="at-tree-world"
            style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}
          >
            <svg
              className="at-connections"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              <defs>
                <filter id="at-packet-glow">
                  <feGaussianBlur stdDeviation="2" />
                </filter>
              </defs>
              {tree.nodes
                .filter((n) => n.parentId)
                .map((node, i) => {
                  const from = layout.positions[node.parentId!],
                    to = layout.positions[node.id];
                  if (!from || !to) return null;
                  const path = `M ${from.x} ${from.y + 102} C ${from.x} ${from.y + 142}, ${to.x} ${to.y - 40}, ${to.x} ${to.y}`;
                  const state = nodeState(node, run, previewId);
                  const active =
                    state === 'running' || state === 'preview' || state === 'coordinating';
                  const done = state === 'succeeded';
                  return (
                    <g
                      key={node.id}
                      className={'at-edge ' + (active ? 'active' : done ? 'done' : 'planned')}
                    >
                      <path className="at-edge-track" d={path} />
                      {active && (
                        <>
                          <path className="at-edge-stream" d={path} />
                          <circle r="6" className="at-packet-halo">
                            <animateMotion dur="1.8s" repeatCount="indefinite" path={path} />
                          </circle>
                          <circle r="3" className="at-packet">
                            <animateMotion dur="1.8s" repeatCount="indefinite" path={path} />
                          </circle>
                        </>
                      )}
                      <circle cx={to.x} cy={to.y} r="3" className="at-port" />
                    </g>
                  );
                })}
            </svg>
            {tree.nodes.map((node) => {
              const pos = layout.positions[node.id];
              if (!pos) return null;
              const state = nodeState(node, run, previewId);
              const root = node.id === 'user';
              const Icon = root
                ? User
                : node.mode === 'research'
                  ? Network
                  : node.mode === 'review'
                    ? ShieldCheck
                    : Bot;
              return (
                <div
                  className={'at-node-wrap ' + (root ? 'root' : '')}
                  key={node.id}
                  style={{ left: pos.x - 122, top: pos.y }}
                >
                  <button
                    className={
                      'at-agent-node ' +
                      (selected === node.id ? 'selected ' : '') +
                      state +
                      (root ? ' root' : '')
                    }
                    onClick={() => onSelect(node.id)}
                    aria-label={'Inspect ' + node.name}
                  >
                    <div className="at-node-top">
                      <span className={'at-node-icon ' + node.mode}>
                        <Icon size={18} />
                      </span>
                      <span className="at-node-title">
                        <b>{node.name}</b>
                        <small>
                          {root ? 'USER / ORCHESTRATOR' : modeLabels[node.mode] + ' agent'}
                        </small>
                      </span>
                      {state === 'running' || state === 'coordinating' ? (
                        <Loader2 size={14} className="spin at-node-status-icon" />
                      ) : state === 'succeeded' ? (
                        <CheckCircle2 size={15} className="at-node-status-icon" />
                      ) : (
                        <span className="at-node-menu">···</span>
                      )}
                    </div>
                    <div className="at-node-bottom">
                      <span className="at-model-chip">
                        <ModelIcon provider={node.provider} />
                        <span>{node.model}</span>
                      </span>
                      <Badge value={state} />
                    </div>
                  </button>
                  {root && (
                    <span className="at-root-tag">
                      <Users size={10} />
                      You direct the team
                    </span>
                  )}
                  {onAdd && tree.nodes.length < 9 && (
                    <button
                      className="at-add-child"
                      onClick={() => onAdd(node.id)}
                      aria-label={'Add child to ' + node.name}
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="at-canvas-legend">
        <span>
          <i className="planned" />
          Planned
        </span>
        <span>
          <i className="working" />
          {preview ? 'Preview traffic' : 'Working'}
        </span>
        <span>
          <i className="complete" />
          Complete
        </span>
        <small>
          {preview
            ? 'Animation previews a handoff. It is not an execution.'
            : 'Select the orchestrator for the full task and activity log.'}
        </small>
      </div>
    </div>
  );
}

function NodeEditor({
  node,
  tree,
  name,
  models,
  onName,
  onChange,
  onAdd,
  onRemove,
}: {
  node: TreeNode;
  tree: AgentTree;
  name: string;
  models: { muse: string; gemini: string };
  onName: (s: string) => void;
  onChange: (v: Partial<TreeNode>) => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const blocked = descendants(tree, node.id);
  const root = node.id === 'user';
  return (
    <>
      <div className="at-inspector-heading">
        <span>{root ? 'ORCHESTRATOR' : 'AGENT'} INSPECTOR</span>
        <Settings2 size={15} />
      </div>
      <div className="at-inspector-identity">
        <span className={'at-node-icon ' + node.mode}>
          {root ? <User size={23} /> : <Bot size={23} />}
        </span>
        <div>
          <h2>{node.name}</h2>
          <p>
            {root ? 'Your task, your team, your control.' : 'A focused role in the larger task.'}
          </p>
        </div>
      </div>
      <div className="at-inspector-section-label">
        CONFIGURATION <span>Editable draft</span>
      </div>
      {root && (
        <label>
          Team name
          <input value={name} maxLength={150} onChange={(e) => onName(e.target.value)} />
        </label>
      )}
      <label>
        {root ? 'Root label' : 'Agent name'}
        <input
          value={node.name}
          maxLength={70}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <div className="at-field-grid">
        <label>
          Provider
          <select
            value={node.provider}
            onChange={(e) => {
              const provider = e.target.value as TreeNode['provider'];
              onChange({ provider, model: models[provider] });
            }}
          >
            <option value="muse">Muse Spark</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
        <label>
          Mode
          <select
            value={node.mode}
            disabled={root}
            onChange={(e) => onChange({ mode: e.target.value as TreeNode['mode'], tools: [] })}
          >
            {Object.entries(modeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Model identifier
        <input
          list={'at-models-' + node.id}
          value={node.model}
          maxLength={100}
          onChange={(e) => onChange({ model: e.target.value })}
        />
        <datalist id={'at-models-' + node.id}>
          <option value={models[node.provider]} />
        </datalist>
      </label>
      <p className="at-mode-description">
        <Sparkles size={13} />
        {modeDescriptions[node.mode]}
      </p>
      <label>
        Instructions
        <textarea
          value={node.instructions}
          minLength={10}
          maxLength={3000}
          onChange={(e) => onChange({ instructions: e.target.value })}
        />
      </label>
      {!root && (
        <label>
          Connected to
          <select
            aria-label="Parent agent"
            value={node.parentId || 'user'}
            onChange={(e) => onChange({ parentId: e.target.value })}
          >
            {tree.nodes
              .filter((n) => !blocked.has(n.id))
              .map((n) => (
                <option value={n.id} key={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {node.mode === 'research' && (
        <fieldset className="at-tool-options">
          <legend>Approved read tools</legend>
          {[
            {
              id: 'org_history',
              label: 'Organization context',
              description: 'Snowflake · opted-in preferences',
            },
            {
              id: 'venue_search',
              label: 'Venue research',
              description: 'SerpAPI · source evidence',
            },
          ].map((tool) => (
            <label key={tool.id}>
              <input
                type="checkbox"
                checked={node.tools.includes(tool.id as 'org_history' | 'venue_search')}
                onChange={(e) =>
                  onChange({
                    tools: e.target.checked
                      ? [...node.tools, tool.id as 'org_history' | 'venue_search']
                      : node.tools.filter((t) => t !== tool.id),
                  })
                }
              />
              <span>
                {tool.label}
                <small>{tool.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="at-node-controls">
        <button onClick={onAdd} disabled={tree.nodes.length >= 9}>
          <Plus size={14} />
          Add child agent
        </button>
        {!root && (
          <button className="at-delete-node" onClick={onRemove}>
            <Trash2 size={13} />
            Remove branch
          </button>
        )}
      </div>
      <div className="at-inspector-safety">
        <ShieldCheck size={14} />
        <span>
          Nodes cannot send, book, buy, or publish. Existing event workflows keep their exact-write
          approvals.
        </span>
      </div>
    </>
  );
}
function AgentInspector({
  node,
  tree,
  task,
  run,
}: {
  node: TreeNode;
  tree: AgentTree;
  task: string;
  run: any;
}) {
  const [tab, setTab] = useState<'activity' | 'output' | 'config'>('activity');
  const root = node.id === 'user';
  const step = run?.steps.find((s: any) => s.id === 'agent_' + node.id);
  const events = (run?.events || []).filter(
    (e: any) =>
      root || e.step_id === 'agent_' + node.id || e.step_id.startsWith('agent_' + node.id + '__'),
  );
  return (
    <>
      <div className="at-inspector-heading">
        <span>{root ? 'ORCHESTRATOR' : 'AGENT'} INSPECTOR</span>
        <Activity size={15} />
      </div>
      <div className="at-inspector-identity">
        <span className={'at-node-icon ' + node.mode}>
          {root ? <User size={23} /> : <Bot size={23} />}
        </span>
        <div>
          <h2>{node.name}</h2>
          <Badge value={nodeState(node, run)} />
        </div>
      </div>
      <div className="at-inspector-tabs">
        {(['activity', 'output', 'config'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'config' ? 'Configuration' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'activity' && (
        <>
          <div className="at-task-summary">
            <small>{root ? 'ORIGINAL TASK' : 'ASSIGNED TASK'}</small>
            <p>{task}</p>
          </div>
          <div className="at-inspector-stats">
            <span>
              <ModelIcon provider={node.provider} />
              {node.model}
            </span>
            <span>
              <Clock3 size={12} />
              {step?.duration_ms ?? '—'} ms
            </span>
          </div>
          <h3 className="at-activity-title">
            {root ? 'Team activity' : 'Agent activity'} <span>{events.length}</span>
          </h3>
          <div className="at-activity-feed">
            {events
              .slice()
              .reverse()
              .slice(0, 14)
              .map((e: any) => (
                <article key={e.id}>
                  <span className={'at-feed-dot ' + (e.kind.includes('failed') ? 'failed' : '')} />
                  <div>
                    <b>{e.data.name || e.kind.replaceAll('.', ' · ')}</b>
                    <p>{e.data.summary || 'Observed execution event.'}</p>
                    <small>
                      {new Date(e.created_at).toLocaleTimeString()} · #{e.id}
                    </small>
                    {(e.data.input || e.data.output) && (
                      <details className="at-event-detail">
                        <summary>
                          Inspect {e.data.output ? 'observed result' : 'step input'}
                        </summary>
                        <pre>{JSON.stringify(e.data.output || e.data.input, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                </article>
              ))}
            {!events.length && (
              <p className="at-waiting">
                <Clock3 size={20} />
                Waiting for an observed step. Planned work has no output yet.
              </p>
            )}
          </div>
        </>
      )}
      {tab === 'output' && (
        <div className="at-visible-output">
          {step?.output?.content ? (
            <>
              <small>{run.mode === 'fixture' ? 'FIXTURE RESULT' : 'OBSERVED MODEL RESULT'}</small>
              <p>{step.output.content}</p>
              {step.output.sourceIds?.length > 0 && (
                <div className="at-source-ids">
                  {step.output.sourceIds.map((s: string) => (
                    <code key={s}>{s}</code>
                  ))}
                </div>
              )}
              {(run.evidence || [])
                .filter((e: any) => step.output.sourceIds?.includes(e.id))
                .map((e: any) => (
                  <article className="at-evidence-result" key={e.id}>
                    <small>
                      {e.source}
                      {e.fixture ? ' · SYNTHETIC FIXTURE' : ''}
                    </small>
                    <h3>{e.title}</h3>
                    <p>{e.excerpt}</p>
                    {e.url && /^https?:\/\//.test(e.url) && (
                      <a href={e.url} target="_blank" rel="noreferrer">
                        Open source <ExternalLink size={11} />
                      </a>
                    )}
                  </article>
                ))}
            </>
          ) : (
            <p className="at-waiting">
              <Clock3 size={22} />
              {root
                ? 'The orchestrator will combine the completed specialist results.'
                : 'This agent has not produced a result yet.'}
            </p>
          )}
        </div>
      )}
      {tab === 'config' && (
        <div className="at-pinned-config">
          <div>
            <small>MODEL</small>
            <p>
              {node.provider} / {node.model}
            </p>
          </div>
          <div>
            <small>MODE</small>
            <p>{modeLabels[node.mode]}</p>
          </div>
          <div>
            <small>INSTRUCTIONS</small>
            <p>{node.instructions}</p>
          </div>
          <div>
            <small>READ TOOLS</small>
            <p>{node.tools.join(', ') || 'No tool access'}</p>
          </div>
          <span>
            <Layers size={13} />
            Immutable configuration pinned to this run.
          </span>
        </div>
      )}
      <div className="at-inspector-safety">
        <ShieldCheck size={14} />
        <span>
          Observed actions and visible results only. Private model reasoning stays private.
        </span>
      </div>
    </>
  );
}

export function TreeExecutionView({
  run,
  busy,
  onCancel,
}: {
  run: any;
  busy: boolean;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState('user');
  const tree = run.config.tree as AgentTree;
  const node = tree.nodes.find((n) => n.id === selected) || tree.nodes[0];
  return (
    <section className="panel at-run-view">
      <div className="at-run-view-heading">
        <div>
          <h2>
            {run.agent_name}
            <span>v{run.version_number}</span>
          </h2>
          <code>{run.id}</code>
        </div>
        <Badge value={run.status} />
        <span className="at-env-label">{run.mode.toUpperCase()}</span>
        {!terminalStates.includes(run.status) && (
          <button disabled={busy} onClick={onCancel}>
            <X size={14} />
            Cancel
          </button>
        )}
      </div>
      {run.error && <div className="alert error">{run.error}</div>}
      <div className="at-board">
        <TreeCanvas
          tree={tree}
          selected={selected}
          onSelect={setSelected}
          preview={false}
          run={run}
        />
        <aside className="at-inspector">
          <AgentInspector node={node} tree={tree} task={run.input.brief} run={run} />
        </aside>
      </div>
    </section>
  );
}
