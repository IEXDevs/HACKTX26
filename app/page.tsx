'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { AgentTreeWorkspace, TreeExecutionView } from './components/agent-trees';
import {
  Activity,
  ArrowDown,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  Database,
  ExternalLink,
  FileText,
  GitBranch,
  Globe,
  KeyRound,
  Layers,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  Network,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  Wallet,
  X,
  XCircle,
  Zap,
} from 'lucide-react';

type Tab = 'Agents' | 'Trees' | 'Runs' | 'Connections' | 'API' | 'Usage';
const nav = [
  { name: 'Agents', icon: Blocks },
  { name: 'Trees', icon: Network },
  { name: 'Runs', icon: GitBranch },
  { name: 'Connections', icon: Network },
  { name: 'API', icon: Code2 },
  { name: 'Usage', icon: Activity },
] as const;
const demoBrief =
  'Plan a welcoming meetup near UT Austin for 80 people within a $3,000 event budget. Include vegetarian food, step-free access, and a quiet space for newcomers.';
const terminal = ['succeeded', 'failed', 'rejected', 'cancelled'];
async function api(path: string, options: RequestInit = {}) {
  const response = await fetch('/v1/' + path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Sign in required');
  }
  if (!response.ok) throw new Error(data.error?.message || 'Request failed');
  return data;
}
function Status({ value }: { value: string }) {
  return (
    <span className={'status ' + value.replaceAll(' ', '-').split('·')[0].trim()}>
      <i />
      {value.replaceAll('_', ' ')}
    </span>
  );
}
function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
function SmallIcon({ children, color = 'violet' }: { children: React.ReactNode; color?: string }) {
  return <span className={'small-icon ' + color}>{children}</span>;
}
function Empty({
  icon: Icon = GitBranch,
  title,
  children,
}: {
  icon?: typeof GitBranch;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={32} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>('Agents');
  const [data, setData] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [run, setRun] = useState<any>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<'run' | 'config' | null>(null);
  const [agent, setAgent] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [treeAgentId, setTreeAgentId] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const d = await api('dashboard');
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const loadRun = useCallback(async () => {
    if (selected)
      try {
        setRun(await api('runs/' + selected));
      } catch (e) {
        setError((e as Error).message);
      }
  }, [selected]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (nav.some((n) => n.name.toLowerCase() === q.get('view')))
      setTab((q.get('view')![0].toUpperCase() + q.get('view')!.slice(1)) as Tab);
    if (q.get('run')) setSelected(q.get('run'));
    if (q.get('tree')) setTreeAgentId(q.get('tree'));
    void load();
  }, [load]);
  useEffect(() => {
    void loadRun();
  }, [loadRun]);
  useEffect(() => {
    const timer = setInterval(() => {
      void load();
      if (selected) void loadRun();
    }, 4000);
    return () => clearInterval(timer);
  }, [load, loadRun, selected]);
  useEffect(() => {
    if (!selected) return;
    const stream = new EventSource('/v1/runs/' + selected + '/events?stream=true');
    const update = () => void loadRun();
    stream.addEventListener('execution', update);
    stream.addEventListener('done', () => {
      stream.close();
      void loadRun();
      void load();
    });
    return () => stream.close();
  }, [selected, loadRun, load]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      await loadRun();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: Tab) {
    const current = new URLSearchParams(window.location.search);
    const currentTree = current.get('tree');
    if (currentTree) setTreeAgentId(currentTree);
    setTab(next);
    const q = new URLSearchParams({ view: next.toLowerCase() });
    if (next === 'Runs' && selected) q.set('run', selected);
    if (next === 'Trees') {
      if (currentTree || treeAgentId) q.set('tree', currentTree || treeAgentId!);
      if (current.get('view') === 'trees' && current.get('treeRun'))
        q.set('treeRun', current.get('treeRun')!);
    }
    history.replaceState(null, '', '?' + q);
  }
  function selectRun(id: string) {
    setSelected(id);
    setRun(null);
    setTab('Runs');
    history.replaceState(null, '', '?view=runs&run=' + id);
  }
  function newRun(a?: any) {
    setAgent(a || data?.agents[0]);
    setModal('run');
  }
  function configureAgent(a: any) {
    if (a.draft.tree) {
      setTreeAgentId(a.id);
      navigate('Trees');
      history.replaceState(null, '', '?view=trees&tree=' + a.id);
    } else {
      setAgent(a);
      setModal('config');
    }
  }
  if (!data)
    return (
      <div className="loading">
        <div className="brand-mark">
          <Layers />
        </div>
        <h2>Relay</h2>
        <p>{error || 'Connecting to your workspace…'}</p>
        {error && <button onClick={() => void load()}>Retry connection</button>}
      </div>
    );
  const approvals = data.runs.filter((r: any) => r.status === 'awaiting_approval').length;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-mark">
            <Layers size={21} />
          </span>
          relay<span className="beta">BETA</span>
        </a>
        <button
          className="workspace-switch"
          onClick={() => setToast(data.workspace.name + ' · ' + data.workspace.id)}
        >
          <span className="workspace-avatar">H</span>
          <span>
            {data.workspace.name}
            <small>Test workspace</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.name}
              className={tab === n.name ? 'active' : ''}
              aria-label={n.name}
              onClick={() => navigate(n.name)}
            >
              <n.icon size={18} />
              <span>{n.name}</span>
              {n.name === 'Runs' && approvals > 0 && <span className="nav-count">{approvals}</span>}
              {n.name === 'API' && <span className="nav-tag">v1</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="credit-card">
            <span>
              <Zap size={15} /> Test credits <b>{data.usage.balance}</b>
            </span>
            <div className="credit-track">
              <i style={{ width: Math.min(100, data.usage.balance) + '%' }} />
            </div>
            <small>Devnet only · no monetary value</small>
            <button onClick={() => navigate('Usage')}>
              Manage credits <ArrowUpRight size={14} />
            </button>
          </div>
          <a
            href="https://github.com/IEXDevs/HACKTX26"
            target="_blank"
            rel="noreferrer"
            className="docs-link"
          >
            <BookOpen size={16} /> Project & setup guide <ArrowUpRight size={14} />
          </a>
          <div className="user-profile">
            <span>HX</span>
            <div>
              HackTX builder<small>Workspace administrator</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="muted">Workspace</span>
            <ChevronRight size={14} />
            <span>{tab}</span>
          </div>
          <div className="topbar-right">
            <span className={'mode-pill ' + data.mode}>
              <i />
              {data.mode === 'fixture' ? 'Fixture environment' : 'Live environment'}
            </span>
            <a href="https://github.com/IEXDevs/HACKTX26" target="_blank" rel="noreferrer">
              HackTX 2026 <ArrowUpRight size={13} />
            </a>
            <span className="avatar">HX</span>
          </div>
        </header>
        <main className={tab === 'Runs' ? 'content runs-content' : 'content'}>
          {error && (
            <div className="alert error" role="alert">
              <XCircle size={17} />
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {tab === 'Agents' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span /> THE AGENT WORKSPACE
                  </div>
                  <h1>Your agents, ready to run.</h1>
                  <p>Configure once. Call from your app. See and control every action.</p>
                </div>
                <button className="primary" onClick={() => newRun()}>
                  <Play size={15} /> Start a run
                </button>
              </div>
              <div className="stats-row">
                {[
                  {
                    label: 'Published agents',
                    value: data.agents.filter((a: any) => a.versions.length).length,
                    icon: Blocks,
                    note: 'Versioned. Reusable.',
                  },
                  {
                    label: 'Total runs',
                    value: data.runs.length,
                    icon: GitBranch,
                    note: 'Actual persisted executions',
                  },
                  {
                    label: 'Awaiting approval',
                    value: approvals,
                    icon: ShieldCheck,
                    note: 'You control the next action',
                  },
                  {
                    label: 'Test credits',
                    value: data.usage.balance,
                    icon: Zap,
                    note: 'Solana devnet only',
                  },
                ].map((s) => (
                  <div className="stat" key={s.label}>
                    <div>
                      <span>{s.label}</span>
                      <s.icon size={16} />
                    </div>
                    <strong>{s.value}</strong>
                    <small>{s.note}</small>
                  </div>
                ))}
              </div>
              <div className="section-bar">
                <div>
                  <h2>
                    Agent library <span className="count">{data.agents.length}</span>
                  </h2>
                  <p>Published versions stay fixed. Your next idea starts with a copy.</p>
                </div>
                <div className="search">
                  <Search size={15} />
                  <input
                    aria-label="Search agents"
                    placeholder="Search agents…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <kbd>/</kbd>
                </div>
              </div>
              <div className="agent-grid">
                {data.agents
                  .filter((a: any) =>
                    (a.name + ' ' + a.description).toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((a: any, i: number) => (
                    <article className={'agent-card ' + (i === 0 ? 'featured' : '')} key={a.id}>
                      <div className="agent-card-top">
                        <SmallIcon color={i === 0 ? 'violet' : 'teal'}>
                          {i === 0 ? <Users size={23} /> : <Search size={23} />}
                        </SmallIcon>
                        <Status value={a.versions.length ? 'published' : 'draft'} />
                      </div>
                      <h3>{a.name}</h3>
                      <p>{a.description}</p>
                      <div className="agent-tags">
                        <span>
                          <Sparkles size={12} />{' '}
                          {a.draft.tree
                            ? a.draft.tree.nodes.length + ' agents'
                            : a.draft.coordinatorModel}
                        </span>
                        <span>
                          <Network size={12} />
                          {a.draft.tools.length} tools
                        </span>
                      </div>
                      <div className="agent-card-meta">
                        <span>
                          {a.versions.length
                            ? 'v' + a.versions[0].version + ' published'
                            : 'Unpublished draft'}
                        </span>
                        <span>{a.draft.readOnly ? 'Read only' : 'Human approval'}</span>
                      </div>
                      <div className="agent-card-actions">
                        <button
                          className="primary"
                          disabled={!a.versions.length}
                          onClick={() => newRun(a)}
                        >
                          <Play size={13} /> Run agent
                        </button>
                        <button onClick={() => configureAgent(a)}>
                          <Settings2 size={14} /> Configure
                        </button>
                        <button
                          className="icon-button"
                          title="Duplicate template"
                          aria-label={'Duplicate ' + a.name}
                          onClick={() =>
                            void action(async () => {
                              const copy = await api('agents/' + a.id + '/duplicate', {
                                method: 'POST',
                              });
                              const d = await api('dashboard');
                              setData(d);
                              configureAgent(d.agents.find((a: any) => a.id === copy.id));
                            })
                          }
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
                <button
                  className="add-agent-card"
                  onClick={() =>
                    void action(async () => {
                      const copy = await api('agents/' + data.agents[0].id + '/duplicate', {
                        method: 'POST',
                      });
                      const d = await api('dashboard');
                      setAgent(d.agents.find((a: any) => a.id === copy.id));
                      setData(d);
                      setModal('config');
                    })
                  }
                >
                  <span>
                    <Plus size={22} />
                  </span>
                  <h3>Make it your own</h3>
                  <p>
                    Duplicate a template.
                    <br />
                    Change its instructions, models, and tools.
                  </p>
                  <b>
                    Create from template <ArrowRight size={14} />
                  </b>
                </button>
              </div>
              <div className="overview-bottom">
                <section className="panel blueprint">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">A CLEAR PATH FROM BRIEF TO ACTION</span>
                      <h2>Built to keep you in the loop.</h2>
                    </div>
                    <span className="subtle-tag">Community Event Operations</span>
                  </div>
                  <div className="horizontal-flow">
                    {[
                      { icon: FileText, title: 'Your brief', sub: 'Text, flyer, or PDF' },
                      { icon: Sparkles, title: 'Understand', sub: 'Gemini extraction' },
                      { icon: Network, title: 'Research & plan', sub: 'Muse Spark + MCP' },
                      { icon: ShieldCheck, title: 'Your approval', sub: 'Review the exact action' },
                    ].map((s, i) => (
                      <div className="flow-item" key={s.title}>
                        <span className={'flow-icon flow-' + i}>
                          <s.icon size={21} />
                        </span>
                        <strong>{s.title}</strong>
                        <small>{s.sub}</small>
                        {i < 3 && <ArrowRight className="flow-arrow" size={17} />}
                      </div>
                    ))}
                  </div>
                  <div className="blueprint-footer">
                    <ShieldCheck size={15} />
                    <span>Read steps run within your limits. Writes wait for approval.</span>
                    <button
                      onClick={() => {
                        navigate('Runs');
                        if (data.runs[0]) selectRun(data.runs[0].id);
                      }}
                    >
                      Inspect a run <ArrowRight size={14} />
                    </button>
                  </div>
                </section>
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <h2>Recent runs</h2>
                    <button onClick={() => navigate('Runs')}>
                      View all <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {data.runs.slice(0, 3).map((r: any) => (
                    <button className="recent-run" key={r.id} onClick={() => selectRun(r.id)}>
                      <span className="run-icon">
                        <GitBranch size={16} />
                      </span>
                      <span>
                        <strong>{r.agent_name}</strong>
                        <small>
                          {r.id.slice(0, 16)} ·{' '}
                          {new Date(r.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </small>
                      </span>
                      <Status value={r.status} />
                    </button>
                  ))}
                  {!data.runs.length && (
                    <Empty title="Your first run starts here">
                      Launch a template to see its actual execution.
                    </Empty>
                  )}
                </section>
              </div>
              <div className="fixture-note">
                <span className="online-dot" />
                <b>
                  {data.mode === 'fixture' ? 'Honest by design.' : 'Live providers enabled.'}
                </b>{' '}
                {data.mode === 'fixture'
                  ? 'Fixture model responses and synthetic source records are labeled. No sponsor API use is implied.'
                  : 'Missing credentials or provider failures stop the run. Inspect each source before you approve.'}
                <button onClick={() => navigate('Connections')}>
                  View connections <ArrowRight size={13} />
                </button>
              </div>
            </>
          )}
          {tab === 'Runs' && (
            <>
              <div className="page-heading compact">
                <div>
                  <div className="eyebrow">EXECUTION WORKSPACE</div>
                  <h1>Every step. In plain sight.</h1>
                  <p>Inspect observed actions, evidence, and the decisions that need you.</p>
                </div>
                <button className="primary" onClick={() => newRun()}>
                  <Plus size={15} /> New run
                </button>
              </div>
              <div className="run-layout">
                <section className="run-list panel">
                  <div className="run-list-heading">
                    <b>All runs</b>
                    <span className="count">{data.runs.length}</span>
                  </div>
                  {data.runs.map((r: any) => (
                    <button
                      className={'run-list-item ' + (selected === r.id ? 'selected' : '')}
                      key={r.id}
                      onClick={() => selectRun(r.id)}
                    >
                      <div>
                        <GitBranch size={15} />
                        <small>
                          {new Date(r.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </small>
                      </div>
                      <strong>{r.agent_name}</strong>
                      <code>{r.id.slice(0, 18)}</code>
                      <Status value={r.status} />
                    </button>
                  ))}
                  {!data.runs.length && (
                    <Empty title="No runs yet">Start a run from a published agent.</Empty>
                  )}
                </section>
                {run ? (
                  run.config.tree ? (
                    <TreeExecutionView
                      run={run}
                      busy={busy}
                      onCancel={() =>
                        void action(async () => {
                          await api('runs/' + run.id + '/cancel', { method: 'POST' });
                        })
                      }
                    />
                  ) : (
                    <RunWorkspace run={run} busy={busy} action={action} onRefresh={loadRun} />
                  )
                ) : (
                  <section className="panel run-empty">
                    <Empty
                      icon={Network}
                      title={selected ? 'Loading your run…' : 'A live view of your workflow'}
                    >
                      {selected
                        ? 'Reading persisted steps and events.'
                        : 'Select a run, or start a new one. Planned nodes appear before execution.'}
                    </Empty>
                    {!selected && (
                      <>
                        <Graph run={null} onSelect={() => {}} selected="" />
                        <button className="primary" onClick={() => newRun()}>
                          Start your first run <ArrowRight size={14} />
                        </button>
                      </>
                    )}
                  </section>
                )}
              </div>
            </>
          )}
          {tab === 'Trees' && (
            <AgentTreeWorkspace
              agents={data.agents}
              mode={data.mode}
              initialAgentId={treeAgentId}
              onChanged={load}
              onOpenRun={selectRun}
            />
          )}
          {tab === 'Connections' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">TRUSTED PROVIDERS & TOOLS</div>
                  <h1>Connected with purpose.</h1>
                  <p>Each provider has a distinct role. Credentials stay on the server.</p>
                </div>
                <span className="subtle-tag">
                  <ShieldCheck size={14} /> Scoped by published version
                </span>
              </div>
              <div className="connection-grid">
                {data.connections.map((c: any, i: number) => (
                  <article className="panel connection-card" key={c.name}>
                    <div>
                      <SmallIcon color={['violet', 'teal', 'blue', 'orange'][i % 4]}>
                        {i === 0 || i === 1 ? (
                          <Sparkles size={21} />
                        ) : i === 3 || i === 4 ? (
                          <Database size={21} />
                        ) : i === 6 ? (
                          <Wallet size={21} />
                        ) : (
                          <Network size={21} />
                        )}
                      </SmallIcon>
                      <Status value={c.state} />
                    </div>
                    <h3>{c.name}</h3>
                    <p>{c.role}</p>
                    <div className="scope">
                      <ShieldCheck size={14} />
                      {c.scope}
                    </div>
                    <small>{c.proof}</small>
                  </article>
                ))}
              </div>
              <div className="alert">
                <KeyRound size={17} /> Configure providers through server environment variables.
                “Configured” means credentials are present; a successful run supplies proof.
              </div>
            </>
          )}
          {tab === 'API' && <ApiView agents={data.agents} action={action} toast={setToast} />}
          {tab === 'Usage' && <UsageView usage={data.usage} action={action} />}
        </main>
        <footer className="footer">
          <span>
            <Layers size={12} /> Relay · Built for the work between idea and action.
          </span>
          <span>
            HackTX 2026 <span className="footer-dot">·</span> v0.1 foundation
          </span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {modal && error && (
        <div className="toast error-toast" role="alert">
          <XCircle size={17} />
          {error}
        </div>
      )}
      {modal === 'run' && agent && (
        <RunModal
          agents={data.agents}
          agent={agent}
          mode={data.mode}
          busy={busy}
          close={() => setModal(null)}
          start={(b) =>
            void action(async () => {
              const created = await api('runs', {
                method: 'POST',
                headers: { 'Idempotency-Key': crypto.randomUUID() },
                body: JSON.stringify(b),
              });
              setModal(null);
              selectRun(created.id);
            })
          }
        />
      )}
      {modal === 'config' && agent && (
        <ConfigModal
          agent={agent}
          busy={busy}
          close={() => setModal(null)}
          save={(b: any) =>
            void action(async () => {
              await api('agents/' + agent.id, { method: 'PUT', body: JSON.stringify(b) });
              setModal(null);
              setToast(b.publish ? 'New immutable version published' : 'Draft saved');
            })
          }
        />
      )}
    </div>
  );
}

function Graph({
  run,
  onSelect,
  selected,
}: {
  run: any;
  onSelect: (id: string) => void;
  selected: string;
}) {
  const steps = run?.steps || [];
  const find = (prefix: string) =>
    steps.filter((s: any) => s.id === prefix || s.id.startsWith(prefix + '_')).at(-1);
  const rounds = steps.filter((s: any) => s.id.startsWith('coordinator_'));
  const tools = steps.filter((s: any) => s.id.startsWith('tool_'));
  const node = (key: string, title: string, sub: string, Icon: typeof Users, kind = 'model') => {
    const step = steps.find((s: any) => s.id === key) || find(key);
    const a = run?.approvals.find((a: any) => a.action === key);
    const review = key === 'review';
    const user = key === 'user';
    const skipped = run?.events?.some((e: any) => e.kind === 'action.skipped' && e.step_id === key);
    const status =
      user && run
        ? 'succeeded'
        : step?.status ||
          a?.status ||
          (skipped
            ? 'skipped'
            : review && run?.status === 'awaiting_requirements'
              ? 'awaiting_requirements'
              : review && run?.requirements && run.status !== 'awaiting_requirements'
                ? 'succeeded'
                : 'planned');
    const nodeId = step?.id || a?.id || key;
    return (
      <button
        className={
          'graph-node ' +
          (status === 'planned' ? 'planned' : 'observed') +
          ' ' +
          (selected === nodeId ? 'selected' : '')
        }
        onClick={() => onSelect(nodeId)}
        key={key}
      >
        <span
          className={
            'node-symbol ' + (kind === 'approval' ? 'amber' : kind === 'tool' ? 'teal' : 'violet')
          }
        >
          <Icon size={17} />
        </span>
        <span className="node-copy">
          <strong>{title}</strong>
          <small>{sub}</small>
        </span>
        {['running', 'queued'].includes(status) ? (
          <Loader2 className="spin" size={14} />
        ) : status === 'succeeded' || status === 'approved' ? (
          <CheckCircle2 size={15} className="success-text" />
        ) : status === 'failed' || status === 'rejected' ? (
          <XCircle size={15} className="error-text" />
        ) : status === 'pending' || status === 'awaiting_requirements' ? (
          <Pause size={14} className="amber-text" />
        ) : (
          <span className="planned-dot" />
        )}
        <span className="node-state">
          {status === 'planned' ? 'Planned' : status.replaceAll('_', ' ')}
        </span>
      </button>
    );
  };
  if (run?.output?.content || run?.config.workflowKind === 'tree_planner')
    return (
      <div className="execution-tree">
        <div className="graph-lane">
          {node('user', 'User request', 'Pinned read-only configuration', Users)}
          <div className="tree-line" />
          {node('completion', 'Read-only completion', run.config.coordinatorModel, Sparkles)}
        </div>
      </div>
    );
  return (
    <div className="execution-tree">
      <div className="graph-lane">
        {node('user', 'User request', 'Brief + published configuration', Users)}
        <div className="tree-line" />
        {node('extract', 'Extract requirements', run?.config.extractionModel || 'Gemini', Sparkles)}
        <div className="tree-line" />
        {node(
          'review',
          'Organizer review',
          'Inspect and correct requirements',
          ShieldCheck,
          'approval',
        )}
        <div className="tree-line" />
        {rounds.length ? (
          rounds.map((m: any, i: number) => {
            const next = rounds[i + 1];
            const children = tools.filter(
              (t: any) =>
                new Date(t.created_at) >= new Date(m.created_at) &&
                (!next || new Date(t.created_at) < new Date(next.created_at)),
            );
            return (
              <div className="graph-round" key={m.id}>
                {node(m.id, 'Coordinator · turn ' + (i + 1), run.config.coordinatorModel, Network)}
                {children.length > 0 && (
                  <>
                    <div className="tree-line" />
                    <div className={'tree-branches ' + (children.length === 1 ? 'single' : '')}>
                      {children.map((t: any) => (
                        <div key={t.id}>
                          {node(
                            t.id,
                            t.input?.tool === 'org_history'
                              ? 'Organization context'
                              : 'Venue evidence',
                            t.input?.tool === 'org_history'
                              ? 'Snowflake · scoped read'
                              : 'SerpAPI · scoped search',
                            t.input?.tool === 'org_history' ? Database : Globe,
                            'tool',
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <div className="tree-line" />
              </div>
            );
          })
        ) : (
          <>
            {node(
              'coordinator',
              'Research coordinator',
              run?.config.coordinatorModel || 'Muse Spark',
              Network,
            )}
            <div className="tree-line" />
            <div className="tree-branches">
              <div>
                {node(
                  'tool_0',
                  'Organization context',
                  'Snowflake · opted-in preferences',
                  Database,
                  'tool',
                )}
              </div>
              <div>
                {node('tool_1', 'Venue evidence', 'SerpAPI · scoped search', Globe, 'tool')}
              </div>
            </div>
            <div className="tree-line" />
          </>
        )}
        {!run?.config.readOnly && (
          <>
            {node(
              'save_brief',
              'Save final brief',
              'Exact content · approval required',
              FileText,
              'approval',
            )}
            <div className="tree-line" />
            {node(
              'publish_page',
              'Publish event page',
              'Exact content · approval required',
              Globe,
              'approval',
            )}
          </>
        )}
        <div className="tree-terminus">
          {run?.status === 'succeeded' ? (
            <CheckCircle2 size={13} />
          ) : (
            <span className="planned-dot" />
          )}{' '}
          {run?.status === 'succeeded' ? 'Workflow complete' : 'Proposed output'}
        </div>
      </div>
    </div>
  );
}
function RunWorkspace({
  run,
  busy,
  action,
  onRefresh,
}: {
  run: any;
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [view, setView] = useState('Execution');
  const [selected, setSelected] = useState('extract');
  const [inspect, setInspect] = useState('Output');
  const step = run.steps.find((s: any) => s.id === selected);
  const approval = run.approvals.find((a: any) => a.id === selected);
  const pending = run.approvals.filter((a: any) => a.status === 'pending');
  return (
    <section className="run-workspace panel">
      <div className="run-heading">
        <div>
          <div>
            <strong>{run.agent_name}</strong>
            <span className="subtle-tag">v{run.version_number}</span>
            <Status value={run.status} />
          </div>
          <code>{run.id}</code>
        </div>
        <div className="run-heading-actions">
          <span className="subtle-tag">{run.mode.toUpperCase()}</span>
          {!terminal.includes(run.status) && (
            <button
              className="icon-button"
              title="Cancel run"
              onClick={() =>
                void action(async () => {
                  await api('runs/' + run.id + '/cancel', { method: 'POST' });
                })
              }
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="run-tabs">
        {['Execution', 'Output', 'Evidence', 'Approvals'].map((t) => (
          <button key={t} onClick={() => setView(t)} className={view === t ? 'active' : ''}>
            {t}
            {t === 'Evidence' && <span>{run.evidence.length}</span>}
            {t === 'Approvals' && pending.length > 0 && (
              <span className="amber-count">{pending.length}</span>
            )}
          </button>
        ))}
        <span className="duration">
          <Clock3 size={13} />
          {(Number(run.active_ms) / 1000).toFixed(1)}s active
        </span>
      </div>
      {run.error && <div className="alert error">{run.error}</div>}
      {run.status === 'awaiting_requirements' && (
        <RequirementsReview
          run={run}
          busy={busy}
          save={(r) =>
            void action(async () => {
              await api('runs/' + run.id + '/requirements', {
                method: 'POST',
                body: JSON.stringify(r),
              });
            })
          }
        />
      )}
      {pending.length > 0 && view !== 'Approvals' && (
        <div className="approval-banner">
          <ShieldCheck size={18} />
          <span>
            <b>Your approval is needed</b>
            <small>Review the exact content before {pending[0].action.replaceAll('_', ' ')}.</small>
          </span>
          <button onClick={() => setView('Approvals')}>
            Review action <ArrowRight size={14} />
          </button>
        </div>
      )}
      {view === 'Execution' && (
        <>
          <div className="graph-inspector">
            <div className="graph-canvas">
              <div className="graph-toolbar">
                <span>
                  <span className="legend-dot executed" /> Observed <span className="legend-dot" />{' '}
                  Planned
                </span>
                <span>Persisted event graph</span>
              </div>
              <Graph run={run} selected={selected} onSelect={setSelected} />
              <div className="graph-caption">
                <ShieldCheck size={12} /> Actions and brief summaries. No private chain-of-thought.
              </div>
            </div>
            <aside className="inspector">
              <div className="inspector-heading">
                <span>STEP INSPECTOR</span>
                <Settings2 size={15} />
              </div>
              <SmallIcon>
                {step?.kind === 'tool' ? <Network size={20} /> : <Sparkles size={20} />}
              </SmallIcon>
              <h3>
                {step?.name ||
                  approval?.action.replaceAll('_', ' ') ||
                  selected.replaceAll('_', ' ')}
              </h3>
              <Status value={step?.status || approval?.status || 'planned'} />
              {step && (
                <div className="step-metrics">
                  <span>
                    <Clock3 size={13} />
                    {step.duration_ms ?? '—'} ms
                  </span>
                  <span>
                    <Zap size={13} />
                    {step.tokens} tokens
                  </span>
                </div>
              )}
              <div className="inspector-tabs">
                {['Output', 'Input'].map((t) => (
                  <button
                    className={inspect === t ? 'active' : ''}
                    key={t}
                    onClick={() => setInspect(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {step ? (
                <Json value={step[inspect.toLowerCase()]} />
              ) : approval ? (
                <Json value={approval.content} />
              ) : (
                <p className="muted inspector-empty">
                  This step is planned. Run the workflow to inspect its observed input and output.
                </p>
              )}
              <div className="redaction-note">
                <ShieldCheck size={13} /> Credentials and contact details are redacted.
              </div>
            </aside>
          </div>
          <div className="event-log">
            <div>
              <h3>
                <Terminal size={14} /> Execution events
              </h3>
              <small>Ordered · replayable · {run.events.length} events</small>
            </div>
            {run.events
              .slice(-8)
              .reverse()
              .map((e: any) => (
                <button className="event-row" key={e.id} onClick={() => setSelected(e.step_id)}>
                  <code>{String(e.id).padStart(4, '0')}</code>
                  <span className={'event-dot ' + (e.kind.includes('failed') ? 'red' : '')} />
                  <b>{e.kind}</b>
                  <span>{e.data.summary || e.data.name || ''}</span>
                  <time>{new Date(e.created_at).toLocaleTimeString()}</time>
                </button>
              ))}
          </div>
        </>
      )}
      {view === 'Output' && (
        <div className="output-panel">
          {run.output ? (
            <PlanOutput plan={run.output} run={run} />
          ) : (
            <Empty icon={FileText} title="The plan is still ahead">
              Confirm requirements and let the approved research steps finish.
            </Empty>
          )}
        </div>
      )}
      {view === 'Evidence' && (
        <div className="evidence-panel">
          <div className="section-bar">
            <h3>Sources attached to this run</h3>
            <span className="subtle-tag">{run.evidence.length} records</span>
          </div>
          {run.evidence.map((e: any) => (
            <article className="evidence-card" key={e.id}>
              <div>
                <span className="subtle-tag">{e.source}</span>
                {e.fixture && <span className="fixture-label">SYNTHETIC FIXTURE</span>}
              </div>
              <h3>{e.title}</h3>
              <p>{e.excerpt}</p>
              <div>
                <code>{e.id}</code>
                {e.url && /^https?:\/\//.test(e.url) && (
                  <a href={e.url} target="_blank" rel="noreferrer">
                    Open source <ExternalLink size={12} />
                  </a>
                )}
                <small>{new Date(e.retrievedAt).toLocaleString()}</small>
              </div>
            </article>
          ))}
          {!run.evidence.length && (
            <Empty icon={Search} title="No evidence retrieved yet">
              Evidence appears after actual MCP read-tool calls complete.
            </Empty>
          )}
        </div>
      )}
      {view === 'Approvals' && (
        <div className="approvals-panel">
          {run.approvals.map((a: any) => (
            <article className="approval-card" key={a.id}>
              <div className="section-bar">
                <h3>
                  <ShieldCheck size={18} />
                  {a.action === 'save_brief'
                    ? 'Save the final brief'
                    : 'Publish the proposed event page'}
                </h3>
                <Status value={a.status} />
              </div>
              <p>
                {a.action === 'save_brief'
                  ? 'Write this exact JSON to private artifact storage.'
                  : 'Publish this exact content to a participant-facing demonstration event page.'}
              </p>
              <label>Action identifier</label>
              <code className="block-code">{a.id}</code>
              <label>Exact content · SHA-256</label>
              <code className="block-code hash">{a.content_hash}</code>
              <details open>
                <summary>Inspect the complete proposed content</summary>
                <Json value={a.content} />
              </details>
              <div className="approval-footer">
                <small>
                  <Clock3 size={13} />
                  Expires {new Date(a.expires_at).toLocaleString()}
                </small>
                {a.status === 'pending' && (
                  <div>
                    <button
                      disabled={busy}
                      className="danger"
                      onClick={() =>
                        void action(async () => {
                          await api('runs/' + run.id + '/approvals/' + a.id, {
                            method: 'POST',
                            body: JSON.stringify({
                              decision: 'reject',
                              contentHash: a.content_hash,
                            }),
                          });
                        })
                      }
                    >
                      <X size={14} /> Reject action
                    </button>
                    <button
                      disabled={busy}
                      className="primary"
                      onClick={() =>
                        void action(async () => {
                          await api('runs/' + run.id + '/approvals/' + a.id, {
                            method: 'POST',
                            body: JSON.stringify({
                              decision: 'approve',
                              contentHash: a.content_hash,
                            }),
                          });
                        })
                      }
                    >
                      <Check size={14} />
                      Approve exact action
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
          {!run.approvals.length && (
            <Empty icon={ShieldCheck} title="No write proposed yet">
              The worker creates an approval for each exact write. Approval pauses survive restarts.
            </Empty>
          )}
        </div>
      )}
    </section>
  );
}
function RequirementsReview({
  run,
  busy,
  save,
}: {
  run: any;
  busy: boolean;
  save: (r: unknown) => void;
}) {
  const [req, setReq] = useState(run.requirements);
  return (
    <form
      className="requirements-review"
      onSubmit={(e) => {
        e.preventDefault();
        save(req);
      }}
    >
      <div>
        <SmallIcon color="orange">
          <FileText size={18} />
        </SmallIcon>
        <span>
          <b>First, make sure we understood.</b>
          <small>Inspect and correct these requirements before research begins.</small>
        </span>
      </div>
      <div className="requirement-fields">
        <label>
          Location
          <input
            required
            value={req.location}
            onChange={(e) => setReq({ ...req, location: e.target.value })}
          />
        </label>
        <label>
          People
          <input
            type="number"
            min="1"
            max="10000"
            required
            value={req.attendees}
            onChange={(e) => setReq({ ...req, attendees: Number(e.target.value) })}
          />
        </label>
        <label>
          Budget · USD
          <input
            type="number"
            min="0"
            max="1000000"
            required
            value={req.budget}
            onChange={(e) => setReq({ ...req, budget: Number(e.target.value) })}
          />
        </label>
        <label>
          Date
          <input
            placeholder="To be confirmed"
            value={req.date || ''}
            onChange={(e) => setReq({ ...req, date: e.target.value || null })}
          />
        </label>
      </div>
      <label>
        Preferences · one per line
        <textarea
          value={req.preferences.join('\n')}
          onChange={(e) =>
            setReq({ ...req, preferences: e.target.value.split('\n').filter(Boolean) })
          }
        />
      </label>
      <details>
        <summary>Unresolved details</summary>
        <Json value={req.unknowns} />
      </details>
      <button className="primary" disabled={busy}>
        Confirm requirements & research <ArrowRight size={14} />
      </button>
    </form>
  );
}
function PlanOutput({ plan, run }: { plan: any; run: any }) {
  if (plan.tree)
    return (
      <>
        <div className="eyebrow">
          {run.mode === 'fixture' ? 'FIXTURE COMPLEXITY PLANNER' : 'MODEL-PLANNED AGENT TREE'}
        </div>
        <h2>Proposed specialist team</h2>
        <p>{plan.tree.rationale}</p>
        <p>
          {plan.tree.nodes.length} agents · {plan.tree.complexity} complexity. This is a proposal,
          not an executed agent tree.
        </p>
        <Json value={plan} />
      </>
    );
  if (plan.content)
    return (
      <>
        <h2>Read-only completion</h2>
        <p>{plan.content}</p>
      </>
    );
  return (
    <>
      <div className="eyebrow">
        {run.mode === 'fixture' ? 'EXPLICIT FIXTURE PLAN' : 'EVIDENCE-BACKED PROPOSAL'}
      </div>
      <h2>{plan.title}</h2>
      <p className="plan-summary">{plan.summary}</p>
      <div className="recommendation">
        <SmallIcon color="teal">
          <CheckCircle2 size={21} />
        </SmallIcon>
        <div>
          <small>PROVISIONAL RECOMMENDATION</small>
          <h3>{plan.recommendation.name}</h3>
          <p>{plan.recommendation.reason}</p>
          <div className="source-tags">
            {plan.recommendation.sourceIds.map((s: string) => (
              <code key={s}>{s}</code>
            ))}
          </div>
        </div>
      </div>
      <h3>Three options, compared</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Venue / fit</th>
              <th>All-in price</th>
              <th>Capacity</th>
              <th>Availability</th>
            </tr>
          </thead>
          <tbody>
            {plan.options.map((o: any) => (
              <tr key={o.name}>
                <td>
                  <b>{o.name}</b>
                  <p>{o.rationale}</p>
                  <div className="source-tags">
                    {o.sourceIds.map((s: string) => (
                      <code key={s}>{s}</code>
                    ))}
                  </div>
                </td>
                <td>{o.price}</td>
                <td>{o.capacity}</td>
                <td>{o.availability}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="plan-columns">
        <section>
          <h3>Proposed schedule</h3>
          {plan.schedule.map((s: any) => (
            <div className="schedule-item" key={s.time}>
              <code>{s.time}</code>
              <span>{s.activity}</span>
            </div>
          ))}
        </section>
        <section>
          <h3>Budget allocations</h3>
          <p className="muted">Planning estimates. These are not venue quotes.</p>
          {plan.budget.map((b: any) => (
            <div className="budget-item" key={b.item}>
              <span>
                {b.item}
                <small>{b.status}</small>
              </span>
              <b>${b.estimatedUsd.toLocaleString()}</b>
            </div>
          ))}
        </section>
      </div>
      <h3>
        Invitation drafts <span className="subtle-tag">Not sent</span>
      </h3>
      {plan.invitationDrafts.map((d: string, i: number) => (
        <blockquote key={i}>{d}</blockquote>
      ))}
      <div className="unresolved">
        <h3>
          <Clock3 size={16} /> Still needs confirmation
        </h3>
        <ul>
          {plan.unresolved.map((u: string, i: number) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      </div>
      {run.artifacts.map((a: any) => (
        <a
          className="artifact-link"
          href={'/v1/artifacts/' + a.action_id}
          target="_blank"
          rel="noreferrer"
        >
          <FileText size={16} />
          Open approved private artifact <ArrowUpRight size={14} />
        </a>
      ))}
      {run.approvals
        .filter((a: any) => a.action === 'publish_page' && a.status === 'approved')
        .map(
          (a: any) =>
            run.steps.some((s: any) => s.id === a.id && s.status === 'succeeded') && (
              <a
                className="primary event-link"
                key={a.id}
                href={'/events/' + a.id}
                target="_blank"
                rel="noreferrer"
              >
                Open approved event page <ExternalLink size={14} />
              </a>
            ),
        )}
    </>
  );
}
function Modal({
  title,
  subtitle,
  close,
  children,
  wide = false,
}: {
  title: string;
  subtitle: string;
  close: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const dismiss = useRef(close);
  dismiss.current = close;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss.current();
      if (e.key === 'Tab') {
        const elements = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select,textarea,a[href]',
          ) || [],
        );
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', listener);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={'modal ' + (wide ? 'wide' : '')}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-button" aria-label="Close dialog" onClick={close}>
            <X size={19} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function RunModal({
  agents,
  agent,
  mode,
  busy,
  close,
  start,
}: {
  agents: any[];
  agent: any;
  mode: string;
  busy: boolean;
  close: () => void;
  start: (b: any) => void;
}) {
  const [a, setA] = useState(agent);
  const [v, setV] = useState(agent.versions[0]?.id || '');
  const [brief, setBrief] = useState(agent.draft.treeTask || demoBrief);
  const [file, setFile] = useState<any>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  return (
    <Modal
      title="Start an agent run"
      subtitle="A published version. Your brief. A fully inspectable execution."
      close={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start({ versionId: v, input: { brief, ...(file ? { fileId: file.id } : {}) }, mode });
        }}
      >
        <label>
          Agent
          <select
            value={a.id}
            onChange={(e) => {
              const next = agents.find((a) => a.id === e.target.value);
              setA(next);
              setV(next.versions[0]?.id || '');
              setBrief(next.draft.treeTask || demoBrief);
            }}
          >
            {agents
              .filter((a) => a.versions.length)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Immutable version
          <select value={v} onChange={(e) => setV(e.target.value)}>
            {a.versions.map((v: any) => (
              <option value={v.id} key={v.id}>
                v{v.version} · {v.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          {a.draft.tree ? 'Your task brief' : 'Your event brief'}
          <textarea
            className="brief-input"
            required
            minLength={10}
            maxLength={15000}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
        </label>
        <label className="upload-zone">
          <FileText size={23} />
          <span>
            {uploading ? 'Storing private input…' : file ? file.name : 'Attach a flyer or PDF'}
            <small>
              {mode === 'fixture'
                ? 'File interpretation requires live Gemini. Use a text brief for fixture runs.'
                : 'PDF, PNG, JPEG · up to 5 MB · private storage'}
            </small>
          </span>
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            disabled={uploading || mode === 'fixture' || !!a.draft.tree}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUploading(true);
              setUploadError('');
              try {
                const form = new FormData();
                form.append('file', f);
                setFile(await api('uploads', { method: 'POST', body: form }));
              } catch (err) {
                setUploadError((err as Error).message);
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
        {file && (
          <button type="button" onClick={() => setFile(null)}>
            Remove file
          </button>
        )}
        {uploadError && <div className="alert error">{uploadError}</div>}
        <div className="alert">
          <ShieldCheck size={16} />
          {mode === 'fixture'
            ? 'Explicit fixture mode: synthetic model and source results. Real queue, MCP transport, and persistence.'
            : 'Live mode: real provider calls. Missing credentials fail visibly.'}
        </div>
        <div className="modal-footer">
          <span>
            <Zap size={14} /> 1 test credit · approvals before writes
          </span>
          <button type="submit" className="primary" disabled={busy || uploading || !v}>
            {busy ? <Loader2 size={15} className="spin" /> : <Play size={15} />}Start run
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ConfigModal({
  agent,
  busy,
  close,
  save,
}: {
  agent: any;
  busy: boolean;
  close: () => void;
  save: (b: any) => void;
}) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [config, setConfig] = useState({ ...agent.draft });
  const update = (key: string, value: unknown) => setConfig({ ...config, [key]: value });
  return (
    <Modal
      title="Configure your agent"
      subtitle="Save a draft, or publish a new immutable version."
      close={close}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({ name, description, config, publish: true });
        }}
      >
        <div className="form-grid">
          <label>
            Agent name
            <input
              required
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Description
            <input
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
        <label>
          Instructions
          <textarea
            className="instructions-input"
            required
            minLength={20}
            maxLength={12000}
            value={config.instructions}
            onChange={(e) => update('instructions', e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Extraction model · Gemini
            <input
              required
              value={config.extractionModel}
              onChange={(e) => update('extractionModel', e.target.value)}
            />
          </label>
          <label>
            Coordinator model · Muse Spark
            <input
              required
              value={config.coordinatorModel}
              onChange={(e) => update('coordinatorModel', e.target.value)}
            />
          </label>
        </div>
        <h3 className="form-subtitle">
          Tool permissions <span className="subtle-tag">Enforced at runtime</span>
        </h3>
        <div className="permission-grid">
          {[
            { key: 'org_history', title: 'Organization context', sub: 'Snowflake · read only' },
            { key: 'venue_search', title: 'Venue research', sub: 'SerpAPI · read only' },
            {
              key: 'save_brief',
              title: 'Save final brief',
              sub: 'Private storage · approval required',
            },
            {
              key: 'publish_page',
              title: 'Publish event page',
              sub: 'Public demo page · approval required',
            },
          ].map((t) => (
            <label className="permission" key={t.key}>
              <input
                type="checkbox"
                checked={config.tools.includes(t.key)}
                onChange={(e) =>
                  update(
                    'tools',
                    e.target.checked
                      ? [...config.tools, t.key]
                      : config.tools.filter((x: string) => x !== t.key),
                  )
                }
              />
              <span>
                <b>{t.title}</b>
                <small>{t.sub}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="form-grid limits-grid">
          {[
            { key: 'maxToolCalls', title: 'Max tool calls', min: 2, max: 12 },
            { key: 'maxModelCalls', title: 'Max coordinator calls', min: 2, max: 10 },
            { key: 'maxOutputTokens', title: 'Max output tokens / call', min: 512, max: 12000 },
            { key: 'activeDeadlineSeconds', title: 'Active deadline · seconds', min: 30, max: 600 },
            {
              key: 'approvalExpirySeconds',
              title: 'Approval expiry · seconds',
              min: 60,
              max: 604800,
            },
          ].map((f) => (
            <label key={f.key}>
              {f.title}
              <input
                type="number"
                required
                min={f.min}
                max={f.max}
                value={config[f.key]}
                onChange={(e) => update(f.key, Number(e.target.value))}
              />
            </label>
          ))}
          <label>
            Output format
            <input value="event_plan_json" readOnly />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={config.readOnly}
            onChange={(e) => update('readOnly', e.target.checked)}
          />{' '}
          Read-only agent · eligible for short completion tasks
        </label>
        <div className="alert">
          <Layers size={16} />
          Existing runs keep their pinned version. New versions do not change their configuration.
        </div>
        <div className="modal-footer">
          <button
            type="button"
            disabled={busy}
            onClick={() => save({ name, description, config, publish: false })}
          >
            Save draft
          </button>
          <button type="submit" className="primary" disabled={busy}>
            <Layers size={15} />
            Publish v{(agent.versions[0]?.version || 0) + 1}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ApiView({
  agents,
  action,
  toast,
}: {
  agents: any[];
  action: (fn: () => Promise<void>) => Promise<void>;
  toast: (s: string) => void;
}) {
  const [keys, setKeys] = useState<any[]>([]);
  const [newKey, setNewKey] = useState('');
  const [name, setName] = useState('Demo client');
  const [approvalScope, setApprovalScope] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const refresh = useCallback(async () => {
    const [keys, requests] = await Promise.all([api('keys'), api('requests')]);
    setKeys(keys.data);
    setRequests(requests.data);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const v = agents[0].versions[0]?.id || 'PUBLISH_A_VERSION';
  const example = `curl -X POST http://localhost:3000/v1/runs \\\n  -H "Authorization: Bearer $RELAY_API_KEY" \\\n  -H "Idempotency-Key: meetup-demo-001" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "versionId": "${v}",\n    "input": {\n      "brief": "Meetup near UT Austin for 80 people, $3,000 budget"\n    }\n  }'`;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">FROM YOUR WORKSPACE TO YOUR APP</div>
          <h1>One agent. Any run.</h1>
          <p>Use the same published configuration from your dashboard and your code.</p>
        </div>
        <span className="subtle-tag">Native API · v1</span>
      </div>
      <div className="api-grid">
        <section className="panel api-example">
          <div className="panel-heading">
            <h2>
              <Terminal size={17} /> Start a workflow
            </h2>
            <button
              onClick={() =>
                void navigator.clipboard.writeText(example).then(() => toast('Request copied'))
              }
            >
              <Copy size={14} />
              Copy
            </button>
          </div>
          <pre>{example}</pre>
          <div className="response-preview">
            <span className="http-status">202 Accepted</span>
            <code>{'{ "id": "run_…", "status": "accepted" }'}</code>
          </div>
          <p>
            Pass a workspace API key and an idempotency key. Retrieve the run, confirm requirements,
            and approve exact actions through the native API.
          </p>
        </section>
        <section className="panel interface-card">
          <h2>Supported interfaces</h2>
          <div>
            <SmallIcon>
              <GitBranch size={18} />
            </SmallIcon>
            <span>
              <b>Native runs API</b>
              <small>Durable workflows, evidence, approvals, cancellation</small>
            </span>
            <Status value="implemented" />
          </div>
          <div>
            <SmallIcon color="teal">
              <Code2 size={18} />
            </SmallIcon>
            <span>
              <b>Chat completions subset</b>
              <small>Short read-only text tasks · no streaming or tools</small>
            </span>
          </div>
          <div>
            <SmallIcon color="blue">
              <Network size={18} />
            </SmallIcon>
            <span>
              <b>MCP delegation</b>
              <small>start_agent_run · get_agent_run via stdio</small>
            </span>
          </div>
          <p>
            No universal IDE compatibility claim. Use the included native API example or MCP client.
          </p>
        </section>
      </div>
      <section className="panel keys-panel">
        <div className="section-bar">
          <div>
            <h2>Platform API keys</h2>
            <p>Workspace scoped. Stored as hashes. Provider credentials stay separate.</p>
          </div>
          <KeyRound size={20} />
        </div>
        <form
          className="key-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const k = await api('keys', {
                method: 'POST',
                body: JSON.stringify({
                  name,
                  scopes: [
                    'runs:read',
                    'runs:write',
                    'agents:read',
                    ...(approvalScope ? ['approvals:write'] : []),
                  ],
                }),
              });
              setNewKey(k.key);
              await refresh();
            });
          }}
        >
          <input
            aria-label="API key name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={approvalScope}
              onChange={(e) => setApprovalScope(e.target.checked)}
            />{' '}
            Allow explicit approval decisions
          </label>
          <button className="primary">
            <Plus size={14} />
            Create key
          </button>
        </form>
        {newKey && (
          <div className="new-key">
            <b>Copy this key now. It will not appear again.</b>
            <div>
              <code>{newKey}</code>
              <button
                onClick={() =>
                  void navigator.clipboard.writeText(newKey).then(() => toast('API key copied'))
                }
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>
                    <code>{k.prefix}…</code>
                  </td>
                  <td>{k.scopes.join(', ')}</td>
                  <td>
                    <Status value={k.revoked_at ? 'revoked' : 'active'} />
                  </td>
                  <td>
                    {!k.revoked_at && (
                      <button
                        className="danger"
                        onClick={() =>
                          void action(async () => {
                            await api('keys/' + k.id, { method: 'DELETE' });
                            await refresh();
                          })
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel published-panel">
        <h2>Published agent identifiers</h2>
        {agents.flatMap((a) =>
          a.versions.map((v: any) => (
            <div key={v.id}>
              <span>
                {a.name} <b>v{v.version}</b>
              </span>
              <code>{v.id}</code>
              <button
                title="Copy published identifier"
                onClick={() =>
                  void navigator.clipboard.writeText(v.id).then(() => toast('Identifier copied'))
                }
              >
                <Copy size={14} />
              </button>
            </div>
          )),
        )}
      </section>
      <section className="endpoint-list panel">
        <div className="section-bar">
          <h2>Recent API requests</h2>
          <button onClick={() => void refresh()}>Refresh</button>
        </div>
        <p>
          Workspace requests made with platform keys. Headers and request bodies are not logged.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Method</th>
                <th>Path</th>
                <th>HTTP status</th>
              </tr>
            </thead>
            <tbody>
              {requests.slice(0, 12).map((r: any, i: number) => (
                <tr key={i}>
                  <td>{new Date(r.created_at).toLocaleTimeString()}</td>
                  <td>{r.method}</td>
                  <td>
                    <code>{r.path}</code>
                  </td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!requests.length && (
          <Empty icon={Code2} title="No API requests recorded yet">
            Call a published version with a platform key to see the request here.
          </Empty>
        )}
      </section>
      <section className="endpoint-list panel">
        <h2>Native API endpoints</h2>
        {[
          ['POST', '/v1/runs', 'Start a pinned, durable run'],
          ['GET', '/v1/runs/:id', 'Retrieve persisted state'],
          ['GET', '/v1/runs/:id/events?stream=true', 'Ordered SSE; reconnect with Last-Event-ID'],
          ['POST', '/v1/runs/:id/requirements', 'Confirm corrected requirements'],
          ['POST', '/v1/runs/:id/approvals/:actionId', 'Approve or reject exact contentHash'],
          ['POST', '/v1/runs/:id/cancel', 'Cancel pending work'],
          ['POST', '/v1/chat/completions', 'Text-only subset for readOnly versions'],
        ].map(([m, p, d]) => (
          <div key={p}>
            <b>{m}</b>
            <code>{p}</code>
            <span>{d}</span>
          </div>
        ))}
      </section>
    </>
  );
}
function UsageView({
  usage,
  action,
}: {
  usage: any;
  action: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [payer, setPayer] = useState('');
  const [invoice, setInvoice] = useState<any>(null);
  const [signature, setSignature] = useState('');
  const values = usage.chart.map((p: any) => p.steps);
  const max = Math.max(1, ...values);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">REAL EXECUTIONS. VISIBLE LIMITS.</div>
          <h1>Know what your agents use.</h1>
          <p>Observed execution telemetry and a transparent test-credit ledger.</p>
        </div>
        <span className="subtle-tag">
          <Clock3 size={13} /> Last 24 hours
        </span>
      </div>
      <div className="stats-row">
        {[
          {
            label: 'Test-credit balance',
            value: usage.balance,
            note: 'Devnet only · no monetary value',
          },
          {
            label: 'Executed steps',
            value: usage.totals.steps,
            note: 'Persisted model and tool observations',
          },
          {
            label: 'Provider-reported tokens',
            value: usage.totals.tokens,
            note: 'Fixture calls report zero model tokens',
          },
          {
            label: 'Estimated model cost',
            value: usage.pricingConfigured
              ? '$' + Number(usage.totals.estimated_usd).toFixed(4)
              : 'Unpriced',
            note: usage.pricingConfigured
              ? 'Approximate · blended configured rates'
              : 'Configure rates to enable estimates',
          },
        ].map((s) => (
          <div className="stat" key={s.label}>
            <div>
              <span>{s.label}</span>
              <Activity size={15} />
            </div>
            <strong>{s.value}</strong>
            <small>{s.note}</small>
          </div>
        ))}
      </div>
      <section className="panel chart-panel">
        <div className="section-bar">
          <div>
            <h2>Execution activity</h2>
            <p>
              Actual completed steps per hour. Fixture runs count as executions, with zero provider
              tokens.
            </p>
          </div>
          <span className="subtle-tag">
            {usage.query.startsWith('time_bucket')
              ? 'Tiger Data · time_bucket'
              : 'PostgreSQL · date_trunc'}
          </span>
        </div>
        {values.length ? (
          <div className="usage-chart">
            <div className="chart-y">
              <span>{max}</span>
              <span>{Math.round(max / 2)}</span>
              <span>0</span>
            </div>
            <div className="chart-bars">
              {usage.chart.map((p: any) => (
                <div className="bar-column" key={p.bucket}>
                  <div className="bar-value">{p.steps}</div>
                  <div
                    className="chart-bar"
                    style={{ height: Math.max(4, (p.steps / max) * 180) }}
                    title={`${p.steps} steps · ${p.tokens} tokens`}
                  />
                  <span>
                    {new Date(p.bucket).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Empty icon={Activity} title="Telemetry starts with your first run">
            This chart reads actual time-series queries. No sample points are inserted.
          </Empty>
        )}
      </section>
      <div className="usage-columns">
        <section className="panel payment-panel">
          <SmallIcon>
            <Wallet size={23} />
          </SmallIcon>
          <h2>Devnet test credits</h2>
          <p>
            Make an invoice for your wallet. Transfer 0.01 devnet SOL with its exact memo to receive
            100 test credits.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () =>
                setInvoice(
                  await api('credits/invoices', {
                    method: 'POST',
                    body: JSON.stringify({ payer }),
                  }),
                ),
              );
            }}
          >
            <label>
              Payer wallet public key
              <input
                required
                placeholder="Your devnet wallet address"
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
              />
            </label>
            <button>
              <Plus size={14} />
              Create devnet invoice
            </button>
          </form>
          {invoice && (
            <>
              <Json value={invoice} />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    await api('credits/verify', {
                      method: 'POST',
                      body: JSON.stringify({ invoiceId: invoice.id, signature }),
                    });
                    setInvoice(null);
                    setSignature('');
                  });
                }}
              >
                <label>
                  Finalized transaction signature
                  <input
                    required
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                  />
                </label>
                <button className="primary">
                  <ShieldCheck size={14} />
                  Verify & credit once
                </button>
              </form>
            </>
          )}
          <div className="alert">
            <ShieldCheck size={15} />
            Verification checks devnet, finality, signer, recipient, amount, invoice, workspace, and
            duplicate signatures.
          </div>
        </section>
        <section className="panel ledger-panel">
          <h2>Credit receipts</h2>
          <p>
            One test credit is reserved per accepted run. Duplicate requests do not debit twice.
          </p>
          {usage.receipts.map((r: any) => (
            <div className="receipt" key={r.id}>
              <SmallIcon color={r.delta > 0 ? 'teal' : 'violet'}>
                {r.delta > 0 ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
              </SmallIcon>
              <span>
                <b>{r.reason}</b>
                <small>{r.reference}</small>
                <small>{new Date(r.created_at).toLocaleString()}</small>
              </span>
              <strong className={r.delta > 0 ? 'success-text' : ''}>
                {r.delta > 0 ? '+' : ''}
                {r.delta}
              </strong>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
