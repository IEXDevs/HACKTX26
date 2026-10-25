'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Archive,
  ArrowLeft,
  House,
  Bot,
  Check,
  Code2,
  CreditCard,
  GitBranch,
  Layers,
  Loader2,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import { AgentTreeWorkspace, TreeExecutionView } from './agent-trees';
import { RunWorkspace, ApiView } from './execution-details';
import { specialistTree, agentPresets } from '@/lib/agent-presets';
import Home from './home';
import { AdvancedSwitch, useAdvanced } from './advanced';
import UsageChart from './usage-chart';
import { placeholderUsageCharts, type UsageRange } from './usage-data';
import { placeholderHome } from './home-data';
import './relay-workspace.css';

type Section = 'home' | 'agents' | 'workflows' | 'usage' | 'billing';
const navigation = [
  { id: 'home', name: 'Home', href: '/', icon: House },
  { id: 'agents', name: 'Agents', href: '/agents', icon: Bot },
  { id: 'workflows', name: 'Workflows', href: '/workflows', icon: GitBranch },
  { id: 'usage', name: 'Usage', href: '/usage', icon: Activity },
  { id: 'billing', name: 'Billing', href: '/billing', icon: CreditCard },
] as const;
const stopped = ['succeeded', 'failed', 'rejected', 'cancelled'];
export async function relayApi(path: string, options: RequestInit = {}) {
  const response = await fetch('/v1/' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const value = await response.json();
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Sign in required');
  }
  if (!response.ok) throw new Error(value.error?.message || 'Request failed');
  return value;
}
function Tag({ status }: { status: string }) {
  return (
    <span className={'studio-tag status-' + status}>
      <i />
      {status.replaceAll('_', ' ')}
    </span>
  );
}
function number(value: any) {
  return Number(value || 0).toLocaleString();
}
function day(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="studio-empty">
      <Layers size={28} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export default function RelayWorkspace({
  section = 'agents',
  workflowId,
}: {
  section?: Section;
  workflowId?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<any>(null),
    [pages, setPages] = useState<any[]>([]),
    [page, setPage] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [create, setCreate] = useState<any>(null),
    [settings, setSettings] = useState<'api' | 'providers' | null>(null),
    [peek, setPeek] = useState<any>(null),
    [selectedRun, setSelectedRun] = useState<string | null>(null),
    [run, setRun] = useState<any>(null);
  const initialized = useRef('');
  const load = useCallback(async () => {
    const [d, w] = await Promise.all([relayApi('dashboard'), relayApi('workflows')]);
    setData(d);
    setPages(w.data);
  }, []);
  const loadPage = useCallback(async () => {
    if (workflowId) setPage(await relayApi('workflows/' + workflowId));
  }, [workflowId]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch(() => {}), 8000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    setPage(null);
    setRun(null);
    setSelectedRun(null);
    initialized.current = '';
    void loadPage().catch((e) => setError(e.message));
  }, [loadPage]);
  useEffect(() => {
    if (!page || initialized.current === page.id) return;
    initialized.current = page.id;
    const requested = new URLSearchParams(window.location.search).get('run');
    const latest = page.runs.find((r: any) => !stopped.includes(r.status)) || page.runs[0];
    setSelectedRun(requested || (latest && !stopped.includes(latest.status) ? latest.id : null));
  }, [page]);
  useEffect(() => {
    if (!data || workflowId || window.location.pathname !== '/') return;
    const q = new URLSearchParams(window.location.search),
      old = q.get('view');
    if (q.get('run')) {
      void relayApi('runs/' + q.get('run')).then((r) => {
        if (r.workflow_id) router.replace('/workflows/' + r.workflow_id + '?run=' + r.id);
        else setPeek(r);
      });
    } else if (q.get('tree')) {
      const w = pages.find((p) => p.agent_id === q.get('tree'));
      router.replace(w ? '/workflows/' + w.id : '/workflows');
    } else if (old === 'usage') router.replace('/usage');
    else if (old === 'trees' || old === 'runs') router.replace('/workflows');
    else if (old === 'connections') setSettings('providers');
    else if (old === 'api') setSettings('api');
  }, [data, workflowId, pages, router]);
  useEffect(() => {
    setRun(null);
    if (!selectedRun) return;
    let disposed = false;
    const refresh = () =>
      relayApi('runs/' + selectedRun)
        .then((r) => {
          if (!disposed) setRun(r);
        })
        .catch((e) => {
          if (!disposed) setError(e.message);
        });
    void refresh();
    const stream = new EventSource('/v1/runs/' + selectedRun + '/events?stream=true');
    stream.addEventListener('execution', () => void refresh());
    stream.addEventListener('done', () => {
      stream.close();
      void refresh();
      void loadPage();
    });
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      disposed = true;
      stream.close();
      clearInterval(timer);
    };
  }, [selectedRun, loadPage]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      await loadPage();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function pickRun(id: string | null) {
    setSelectedRun(id);
    if (workflowId)
      router.replace('/workflows/' + workflowId + (id ? '?run=' + id : ''), { scroll: false });
  }
  async function openRun(id: string) {
    const value = await relayApi('runs/' + id);
    if (value.workflow_id) router.push('/workflows/' + value.workflow_id + '?run=' + id);
    else setPeek(value);
  }
  async function archive(w: any) {
    await relayApi('workflows/' + w.id, {
      method: 'PATCH',
      body: JSON.stringify({ revision: w.revision, archived: !w.archived_at }),
    });
    await load();
    await loadPage();
  }
  if (!data)
    return (
      <div className="studio-loading">
        <span className="studio-logo">
          <Layers size={24} />
        </span>
        <h2>Relay</h2>
        <p>{error || 'Opening your workspace…'}</p>
        {error && <button onClick={() => void load()}>Retry</button>}
      </div>
    );
  return (
    <div className="studio-shell">
      <aside className="studio-sidebar">
        <Link href="/" className="studio-brand">
          <span className="studio-logo">
            <Layers size={16} />
          </span>
          <span>Relay</span>
        </Link>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={section === item.id ? 'active' : ''}
              aria-current={section === item.id ? 'page' : undefined}
              title={item.name}
            >
              <item.icon size={17} aria-hidden="true" />
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>
        <div className="studio-sidebar-bottom">
          <span className={'studio-mode' + (data.mode === 'live' ? ' live' : '')}>
            {data.mode === 'live' ? 'Live' : 'Test mode'}
          </span>
          <button onClick={() => setSettings('api')} title="API access">
            <Code2 size={16} aria-hidden="true" />
            <span>API access</span>
          </button>
          <button onClick={() => setSettings('providers')} title="Workspace settings">
            <Settings2 size={16} aria-hidden="true" />
            <span>Settings</span>
          </button>
          <div className="studio-profile">
            <span aria-hidden="true">H</span>
            <b>{data.workspace.name}</b>
          </div>
        </div>
      </aside>
      <div className="studio-body">
        <main className={'studio-main ' + (workflowId ? 'studio-canvas-page' : '')}>
          {error && (
            <div role="alert" className="studio-alert error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="studio-alert">
              <Check size={15} />
              {notice}
              <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {section === 'home' && (
            <Home
              data={placeholderHome}
              testMode={data.mode !== 'live'}
              onNew={() => setCreate({})}
            />
          )}
          {section === 'agents' && (
            <AgentLibrary
              agents={data.agents}
              busy={busy}
              action={action}
              onUse={(a) => setCreate({ agent: a })}
              onSaved={() => setNotice('Agent saved.')}
            />
          )}
          {section === 'workflows' && !workflowId && (
            <WorkflowIndex
              pages={pages}
              onCreate={() => setCreate({})}
              onArchive={(w) => void action(() => archive(w))}
              busy={busy}
            />
          )}
          {section === 'workflows' &&
            workflowId &&
            (page ? (
              <>
                <div className="studio-workflow-header">
                  <Link href="/workflows" aria-label="Back to workflows">
                    <ArrowLeft size={17} />
                  </Link>
                  <div>
                    <h1>{page.name}</h1>
                    <span>
                      {page.kind === 'tree' ? 'Agent tree' : 'Individual agent'}
                      <i /> {page.runs.length} runs
                    </span>
                  </div>
                  {page.archived_at && <Tag status="archived" />}
                  <select
                    aria-label="Workflow run history"
                    value={selectedRun || ''}
                    onChange={(e) => pickRun(e.target.value || null)}
                  >
                    <option value="">Editable draft</option>
                    {page.runs.map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {day(r.created_at)} · {r.status.replaceAll('_', ' ')} · {r.id.slice(-6)}
                      </option>
                    ))}
                  </select>
                  <button disabled={busy} onClick={() => void action(() => archive(page))}>
                    <Archive size={14} />
                    {page.archived_at ? 'Restore' : 'Archive'}
                  </button>
                </div>
                <div className="studio-workflow-stage">
                  {page.kind === 'tree' ? (
                    <div className={page.archived_at ? 'studio-archived-canvas' : ''}>
                      {page.archived_at && (
                        <div className="studio-archive-message">
                          Archived page. Run history remains available. Restore it to edit or start
                          a run.
                        </div>
                      )}
                      <AgentTreeWorkspace
                        key={page.id}
                        agents={data.agents}
                        mode={data.mode}
                        page={page}
                        initialRunId={selectedRun}
                        onPageSaved={async () => {
                          await loadPage();
                          await load();
                        }}
                        onPageRun={(id) => pickRun(id || null)}
                        onChanged={load}
                        onOpenRun={(id) => void openRun(id)}
                      />
                    </div>
                  ) : (
                    <IndividualWorkflow
                      page={page}
                      run={run}
                      selectedRun={selectedRun}
                      agents={data.agents}
                      busy={busy}
                      action={action}
                      refresh={loadPage}
                      onRun={pickRun}
                      mode={data.mode}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="studio-loading-inline">
                <Loader2 className="spin" />
                Opening workflow page…
              </div>
            ))}
          {section === 'usage' && (
            <UsageDiagnostics usage={data.usage} pages={pages} onRun={(id) => void openRun(id)} />
          )}
          {section === 'billing' && <Billing usage={data.usage} />}
        </main>
      </div>
      {create && (
        <NewWorkflow
          agents={data.agents}
          initial={create}
          close={() => setCreate(null)}
          busy={busy}
          create={(body) =>
            void action(async () => {
              const result = await relayApi('workflows', {
                method: 'POST',
                headers: { 'Idempotency-Key': crypto.randomUUID() },
                body: JSON.stringify(body),
              });
              setCreate(null);
              router.push('/workflows/' + result.id);
            })
          }
        />
      )}
      {settings && (
        <div className="studio-modal-backdrop" onClick={() => setSettings(null)}>
          <section
            className="studio-settings"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace settings"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="studio-dialog-heading">
              <div>
                <small>WORKSPACE</small>
                <h2>Settings & integrations</h2>
              </div>
              <button aria-label="Close settings" onClick={() => setSettings(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="studio-filter-tabs">
              <button
                className={settings === 'providers' ? 'selected' : ''}
                onClick={() => setSettings('providers')}
              >
                Providers
              </button>
              <button
                className={settings === 'api' ? 'selected' : ''}
                onClick={() => setSettings('api')}
              >
                API access
              </button>
            </div>
            {settings === 'api' ? (
              <ApiView agents={data.agents} action={action} toast={setNotice} />
            ) : (
              <div className="studio-provider-list">
                {data.connections.map((c: any) => (
                  <article key={c.name}>
                    <div>
                      <b>{c.name}</b>
                      <Tag status={c.state} />
                    </div>
                    <p>{c.role}</p>
                    <small>{c.scope}</small>
                    <p>{c.proof}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {peek && (
        <div className="studio-modal-backdrop" onClick={() => setPeek(null)}>
          <section
            className="studio-settings"
            role="dialog"
            aria-modal="true"
            aria-label="Planning run"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="studio-dialog-heading">
              <h2>{peek.agent_name}</h2>
              <button onClick={() => setPeek(null)} aria-label="Close run">
                <X size={18} />
              </button>
            </div>
            <Tag status={peek.status} />
            <pre className="json">
              {JSON.stringify(
                { steps: peek.steps, output: peek.output, error: peek.error },
                null,
                2,
              )}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}

function isTeam(a: any) {
  return !a.draft.tree || a.draft.tree.nodes.length > 2;
}
function AgentLibrary({
  agents,
  busy,
  action,
  onUse,
  onSaved,
}: {
  agents: any[];
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  onUse: (a: any) => void;
  onSaved: () => void;
}) {
  const [search, setSearch] = useState(''),
    [advanced, toggleAdvanced] = useAdvanced(),
    [editorOpen, setEditorOpen] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [instructions, setInstructions] = useState(''),
    [model, setModel] = useState(agents[0]?.draft.coordinatorModel || 'muse-spark-1.3'),
    [role, setRole] = useState<'reason' | 'research' | 'review'>('reason');
  const key = useRef<string | null>(null);
  const visible = agents
    .filter((a) => !a.workflow_internal && !isTeam(a))
    .filter((a) =>
      [a.name, a.description, a.draft.instructions, a.draft.coordinatorModel]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      const rank = (item: any) => {
        const index = agentPresets.findIndex((p) => 'agt_preset_' + p.id === item.id);
        return index < 0 ? 10 : index;
      };
      return rank(a) - rank(b);
    });
  function choose(a: any) {
    setSelected(a);
    setName(a.name);
    setDescription(a.description);
    const node = a.draft.tree?.nodes.find((n: any) => n.id !== 'user');
    setInstructions(node?.instructions || a.draft.instructions);
    setModel(node?.model || a.draft.coordinatorModel);
    setRole(node?.mode === 'research' ? 'research' : node?.mode === 'review' ? 'review' : 'reason');
    key.current = null;
    setEditorOpen(true);
  }
  function createAgent() {
    setSelected(null);
    setName('');
    setDescription('');
    setInstructions('');
    setModel(agents[0]?.draft.coordinatorModel || 'muse-spark-1.3');
    setRole('reason');
    key.current = null;
    setEditorOpen(true);
  }
  function config() {
    const base = agents.find((a) => a.id === 'agt_community_meta')?.draft || agents[0].draft;
    const tools = role === 'research' ? (['venue_search'] as 'venue_search'[]) : [];
    const tree = specialistTree({ name, instructions, model, mode: role, tools });
    return {
      ...base,
      extractionProvider: 'muse',
      extractionModel: model,
      coordinatorModel: model,
      instructions: tree.nodes[0].instructions,
      workflowKind: 'tree',
      tree,
      outputFormat: 'agent_tree_json',
      readOnly: true,
      tools,
      maxModelCalls: Math.max(5, tree.nodes.length),
    };
  }
  async function save(publish: boolean) {
    if (selected && (!selected.draft.tree || selected.draft.tree.nodes.length > 2)) {
      throw new Error('This agent is a full team. Open it from Workflows to change it.');
    }
    const body = { name, description, config: config(), publish };
    const result = selected
      ? await relayApi('agents/' + selected.id, { method: 'PUT', body: JSON.stringify(body) })
      : await relayApi('agents', {
          method: 'POST',
          headers: { 'Idempotency-Key': key.current || (key.current = crypto.randomUUID()) },
          body: JSON.stringify(body),
        });
    setSelected({ ...selected, id: result.id, name, description, draft: body.config });
    key.current = null;
    onSaved();
    setEditorOpen(false);
  }
  const fullTemplate = selected && (!selected.draft.tree || selected.draft.tree.nodes.length > 2);
  return (
    <>
      <div className="simple-page wide">
        <div className="simple-top">
          <h1>Agents</h1>
          <div className="simple-actions">
            <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
            <button className="primary" onClick={createAgent}>
              <Plus size={15} />
              New agent
            </button>
          </div>
        </div>
        <div className="simple-toolbar">
          <label className="simple-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search agents</span>
            <input
              type="search"
              placeholder="Search agents"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {visible.length ? (
          <section className="tile-section">
            <div className="tile-grid">
              {visible.map((a) => {
                const node = a.draft.tree?.nodes.find((n: any) => n.id !== 'user'),
                  published = a.versions?.[0],
                  legacy = a.draft.extractionProvider !== 'muse',
                  searches = a.draft.tools.includes('venue_search'),
                  job = searches
                    ? 'Researches the web'
                    : node?.mode === 'review'
                      ? 'Reviews work'
                      : 'Writes';
                return (
                  <article className="tile" key={a.id}>
                    <button
                      className="tile-main"
                      aria-label={'Edit ' + a.name}
                      onClick={() => choose(a)}
                    >
                      <span className="tile-icon" aria-hidden="true">
                        {searches ? (
                          <Search size={18} />
                        ) : node?.mode === 'review' ? (
                          <ShieldCheck size={18} />
                        ) : (
                          <Bot size={18} />
                        )}
                      </span>
                      <b>
                        {a.name}
                        {!published && <em className="simple-tag">Draft</em>}
                      </b>
                      <p>{a.description}</p>
                    </button>
                    <footer className="tile-foot">
                      <span>
                        {advanced
                          ? (node?.model || a.draft.coordinatorModel) +
                            (published ? ' · v' + published.version : '')
                          : job}
                      </span>
                      {legacy ? (
                        <span className="simple-muted">Unavailable</span>
                      ) : (
                        <button
                          className="simple-button"
                          disabled={!published}
                          title={published ? undefined : 'Publish this agent to use it'}
                          onClick={() => onUse(a)}
                        >
                          Use
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          </section>
        ) : (
          <p className="simple-empty">No agents match that search.</p>
        )}
      </div>
      {editorOpen && (
        <div className="studio-modal-backdrop" onClick={() => setEditorOpen(false)}>
          <aside
            className="studio-agent-editor studio-agent-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={selected ? 'Configure agent' : 'Create an agent'}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="studio-editor-heading">
              <div>
                <h2>{selected ? 'Edit agent' : 'New agent'}</h2>
              </div>
              <button onClick={() => setEditorOpen(false)} aria-label="Close agent editor">
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(() => save(true));
              }}
            >
              <label>
                Name
                <input
                  required
                  maxLength={150}
                  placeholder="e.g. Community researcher"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                What it does
                <input
                  maxLength={500}
                  placeholder="One short sentence"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <div className="studio-label-row">
                <label htmlFor="agent-instructions">Instructions</label>
              </div>
              <textarea
                id="agent-instructions"
                required
                minLength={20}
                maxLength={3000}
                placeholder="You are a thoughtful research assistant. Find useful sources, compare the options, and flag what still needs confirmation…"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
              <label>
                Job
                <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  <option value="reason">Write</option>
                  <option value="research">Research the web</option>
                  <option value="review">Review</option>
                </select>
              </label>
              {advanced && (
                <label>
                  Model
                  <input
                    required
                    value={model}
                    maxLength={100}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </label>
              )}
              {fullTemplate && (
                <div className="studio-alert">
                  This agent is a full team. Open it from Workflows to change it.
                </div>
              )}
              <div className="studio-editor-footer">
                <div>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      fullTemplate ||
                      name.trim().length < 1 ||
                      instructions.trim().length < 20
                    }
                    onClick={() => void action(() => save(false))}
                  >
                    Save draft
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy || fullTemplate || !name.trim() || instructions.trim().length < 20
                    }
                  >
                    {busy && <Loader2 className="spin" size={14} />}Publish
                  </button>
                </div>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}

function WorkflowIndex({
  pages,
  onCreate,
  onArchive,
  busy,
}: {
  pages: any[];
  onCreate: () => void;
  onArchive: (w: any) => void;
  busy: boolean;
}) {
  const [archived, setArchived] = useState(false),
    [search, setSearch] = useState(''),
    [advanced, toggleAdvanced] = useAdvanced();
  const visible = pages
    .filter((p) => (archived ? p.archived_at : !p.archived_at))
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  const archivedCount = pages.filter((p) => p.archived_at).length;
  return (
    <div className="simple-page wide">
      <div className="simple-top">
        <h1>Workflows</h1>
        <div className="simple-actions">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
          <button className="primary" onClick={onCreate}>
            <Plus size={15} />
            New workflow
          </button>
        </div>
      </div>
      {pages.length > 0 && (
        <div className="simple-toolbar">
          <div className="simple-tabs" role="group" aria-label="Show workflows">
            <button aria-pressed={!archived} onClick={() => setArchived(false)}>
              Active
            </button>
            <button aria-pressed={archived} onClick={() => setArchived(true)}>
              Archived{archivedCount > 0 && ' · ' + archivedCount}
            </button>
          </div>
          <label className="simple-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search workflows</span>
            <input
              type="search"
              placeholder="Search workflows"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      )}
      {visible.length ? (
        (archived
          ? [{ title: 'Archived', items: visible }]
          : [
              {
                title: 'Waiting for you',
                items: visible.filter((w) => workflowStatus(w).group === 'waiting'),
              },
              {
                title: 'Running',
                items: visible.filter((w) => workflowStatus(w).group === 'running'),
              },
              {
                title: 'Recent',
                items: visible.filter((w) => workflowStatus(w).group === 'recent'),
              },
            ]
        )
          .filter((group) => group.items.length)
          .map((group) => (
            <section className="tile-section" key={group.title}>
              <h2>
                {group.title} · {group.items.length}
              </h2>
              <div className="tile-grid">
                {group.items.map((w) => {
                  const status = workflowStatus(w);
                  return (
                    <article className="tile" key={w.id}>
                      <Link href={'/workflows/' + w.id} className="tile-main">
                        <span className={'tile-status ' + status.tone}>{status.label}</span>
                        <b>{w.name}</b>
                        <p>{w.task || 'No task yet.'}</p>
                      </Link>
                      <footer className="tile-foot">
                        <span>
                          {w.kind === 'tree'
                            ? 'Team of ' + Math.max(1, (w.tree?.nodes?.length || 2) - 1) + ' agents'
                            : 'Single agent'}
                          {advanced &&
                            ' · ' +
                              w.run_count +
                              (w.run_count === 1 ? ' run' : ' runs') +
                              ' · edited ' +
                              day(w.updated_at)}
                        </span>
                        <button
                          className="simple-icon-button"
                          aria-label={(w.archived_at ? 'Restore ' : 'Archive ') + w.name}
                          title={w.archived_at ? 'Restore' : 'Archive'}
                          disabled={busy}
                          onClick={() => onArchive(w)}
                        >
                          <Archive size={16} />
                        </button>
                      </footer>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
      ) : (
        <p className="simple-empty">
          {archived
            ? 'Nothing is archived.'
            : search
              ? 'No workflows match that search.'
              : 'No workflows yet. Start one from Home or with New workflow.'}
        </p>
      )}
    </div>
  );
}
function workflowStatus(w: any): {
  label: string;
  tone: string;
  group: 'waiting' | 'running' | 'recent';
} {
  if (w.archived_at) return { label: 'Archived', tone: '', group: 'recent' };
  const when = w.updated_at ? ' ' + day(w.updated_at) : '';
  switch (w.latest_status) {
    case 'queued':
    case 'running':
      return { label: 'Running now', tone: 'running', group: 'running' };
    case 'awaiting_requirements':
    case 'awaiting_approval':
      return { label: 'Waiting for you', tone: 'waiting', group: 'waiting' };
    case 'succeeded':
      return { label: 'Finished' + when, tone: '', group: 'recent' };
    case 'failed':
      return { label: 'Stopped' + when, tone: 'stopped', group: 'recent' };
    case 'rejected':
      return { label: 'You rejected a step' + when, tone: '', group: 'recent' };
    case 'cancelled':
      return { label: 'Cancelled' + when, tone: '', group: 'recent' };
    default:
      return { label: 'Not run yet', tone: '', group: 'recent' };
  }
}

function NewWorkflow({
  agents,
  initial,
  close,
  busy,
  create,
}: {
  agents: any[];
  initial: any;
  close: () => void;
  busy: boolean;
  create: (value: any) => void;
}) {
  const [kind, setKind] = useState<'tree' | 'agent'>(initial.agent ? 'agent' : 'tree'),
    [agentId, setAgentId] = useState(
      initial.agent?.id || agents.find((a) => a.versions.length)?.id || '',
    ),
    [name, setName] = useState(initial.agent?.name || ''),
    [task, setTask] = useState(initial.task || '');
  const agent = agents.find((a) => a.id === agentId);
  return (
    <div className="studio-modal-backdrop" onClick={close}>
      <section
        className="studio-new-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Create workflow page"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="studio-dialog-heading">
          <div>
            <small>A FRESH PAGE</small>
            <h2>Create a workflow</h2>
          </div>
          <button onClick={close} aria-label="Close new workflow">
            <X size={18} />
          </button>
        </div>
        <p>Choose how you want to work. You can edit the task and tree on its page.</p>
        <div className="studio-kind-picker">
          <button className={kind === 'tree' ? 'selected' : ''} onClick={() => setKind('tree')}>
            <GitBranch size={22} />
            <b>Agent tree</b>
            <small>Build a team around your task</small>
          </button>
          <button className={kind === 'agent' ? 'selected' : ''} onClick={() => setKind('agent')}>
            <Bot size={22} />
            <b>Individual agent</b>
            <small>Start with one specialist</small>
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create({
              name,
              kind,
              task,
              ...(kind === 'agent' ? { versionId: agent?.versions[0]?.id } : {}),
            });
          }}
        >
          <label>
            Page name
            <input
              required
              autoFocus
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Austin community meetup"
            />
          </label>
          {kind === 'agent' && (
            <label>
              Library agent
              <select required value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {agents
                  .filter((a) => a.versions.length && a.draft.extractionProvider === 'muse')
                  .map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name} · v{a.versions[0].version}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Task <span className="studio-optional">optional for now</span>
            <textarea
              maxLength={15000}
              placeholder="What do you want to accomplish?"
              value={task}
              onChange={(e) => setTask(e.target.value)}
            />
          </label>
          <div className="studio-dialog-footer">
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !name.trim() || (kind === 'agent' && !agent?.versions[0])}
            >
              <Plus size={15} />
              Create page
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function IndividualWorkflow({
  page,
  run,
  selectedRun,
  agents,
  busy,
  action,
  refresh,
  onRun,
  mode,
}: {
  page: any;
  run: any;
  selectedRun: string | null;
  agents: any[];
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  onRun: (id: string | null) => void;
  mode: string;
}) {
  const [task, setTask] = useState(page.task),
    [version, setVersion] = useState(page.version_id),
    [name, setName] = useState(page.name);
  const launchKey = useRef<string | null>(null);
  const config =
    agents.flatMap((a) => a.versions).find((v) => v.id === version)?.config || page.config;
  async function save(start: boolean) {
    const saved = await relayApi('workflows/' + page.id, {
      method: 'PATCH',
      body: JSON.stringify({ revision: page.revision, task, name, versionId: version }),
    });
    await refresh();
    if (start) {
      const result = await relayApi('workflows/' + page.id + '/runs', {
        method: 'POST',
        headers: {
          'Idempotency-Key': launchKey.current || (launchKey.current = crypto.randomUUID()),
        },
        body: JSON.stringify({ revision: saved.revision }),
      });
      launchKey.current = null;
      onRun(result.id);
    }
  }
  if (selectedRun)
    return (
      <div className="studio-individual-execution">
        <div className="studio-back-draft">
          <button onClick={() => onRun(null)}>
            <ArrowLeft size={14} />
            Back to draft
          </button>
        </div>
        {run ? (
          run.config.tree ? (
            <TreeExecutionView
              run={run}
              busy={busy}
              onCancel={() =>
                void action(async () => {
                  await relayApi('runs/' + run.id + '/cancel', { method: 'POST' });
                })
              }
            />
          ) : (
            <RunWorkspace run={run} busy={busy} action={action} onRefresh={refresh} />
          )
        ) : (
          <div className="studio-loading-inline">
            <Loader2 className="spin" />
            Reading execution…
          </div>
        )}
      </div>
    );
  return (
    <div className="studio-individual-draft">
      <div className="studio-single-command">
        <label>
          Task
          <textarea
            aria-label="Individual agent task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Give this agent a task…"
          />
        </label>
        <button
          disabled={busy || !!page.archived_at}
          onClick={() => void action(() => save(false))}
        >
          Save draft
        </button>
        <button
          className="primary"
          disabled={busy || !!page.archived_at || task.trim().length < 10}
          onClick={() => void action(() => save(true))}
        >
          <Zap size={15} />
          Run agent
        </button>
      </div>
      <div className="studio-single-stage">
        <div className="studio-single-flow">
          <span className="studio-flow-user">
            <Bot size={19} />
            <b>You / Orchestrator</b>
            <small>Your task, your control</small>
          </span>
          <span className="studio-flow-line" />
          <span className="studio-single-node">
            <span className="studio-agent-symbol color-0">
              <Bot size={23} />
            </span>
            <b>
              {agents.find((a) => a.versions.some((v: any) => v.id === version))?.name ||
                'Selected agent'}
            </b>
            <small>∞ {config?.coordinatorModel}</small>
            <Tag status="planned" />
          </span>
          <p>Planned configuration · no execution yet</p>
        </div>
        <aside className="studio-single-settings">
          <h3>Agent configuration</h3>
          <label>
            Page name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Published version
            <select value={version} onChange={(e) => setVersion(e.target.value)}>
              {agents.flatMap((a) =>
                a.versions.map((v: any) => (
                  <option key={v.id} value={v.id}>
                    {a.name} · v{v.version}
                  </option>
                )),
              )}
            </select>
          </label>
          <small>INSTRUCTIONS</small>
          <p>
            {config?.tree?.nodes.find((n: any) => n.id !== 'user')?.instructions ||
              config?.instructions}
          </p>
          <small>PERMISSIONS</small>
          <p>{config?.tools.join(', ') || 'Text generation only'}</p>
          <div className="studio-alert">
            <ShieldCheck size={15} />
            This run pins the selected published version.{' '}
            {mode === 'fixture'
              ? 'Fixture results are synthetic.'
              : 'Provider calls use live credentials.'}
          </div>
        </aside>
      </div>
    </div>
  );
}

function UsageDiagnostics({
  usage,
  pages,
  onRun,
}: {
  usage: any;
  pages: any[];
  onRun: (id: string) => void;
}) {
  const [range, setRange] = useState('7d'),
    [mode, setMode] = useState('all'),
    [tab, setTab] = useState('Workflows'),
    [advanced, toggleAdvanced] = useAdvanced(),
    [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setData(null);
    const load = () =>
      relayApi('diagnostics?range=' + range + '&mode=' + mode)
        .then((d) => {
          if (!disposed) {
            setData(d);
            setError('');
          }
        })
        .catch((e) => {
          if (!disposed) setError(e.message);
        });
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [range, mode]);
  const rows = data
    ? tab === 'Agents'
      ? data.agents
      : tab === 'Models'
        ? data.models
        : data.workflows
    : [];
  const failures = data?.failures || [];
  return (
    <div className="simple-page wide">
      <div className="simple-top">
        <h1>Usage</h1>
        <div className="simple-actions">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
          <select
            className="simple-select"
            aria-label="Time range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="all">All time</option>
          </select>
          {advanced && (
            <select
              className="simple-select"
              aria-label="Run mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="all">All runs</option>
              <option value="live">Live only</option>
              <option value="fixture">Test only</option>
            </select>
          )}
        </div>
      </div>
      {error && <div className="studio-alert error">{error}</div>}
      <UsageChart charts={placeholderUsageCharts(range as UsageRange)} sample />
      <dl className="simple-stats">
        <div>
          <dt>Runs</dt>
          <dd>{data ? number(data.totals.runs) : '—'}</dd>
        </div>
        <div>
          <dt>Problems</dt>
          <dd className={failures.length ? 'stopped' : ''}>
            {data ? number(failures.length) : '—'}
          </dd>
        </div>
        <div>
          <dt>Credits left</dt>
          <dd>{number(usage.balance)}</dd>
        </div>
        {advanced && (
          <div>
            <dt>Average step</dt>
            <dd>{data ? (Number(data.totals.avg_ms || 0) / 1000).toFixed(1) + 's' : '—'}</dd>
          </div>
        )}
      </dl>

      <section className="simple-section">
        <h2>Problems{failures.length > 0 && ' · ' + failures.length}</h2>
        {failures.length ? (
          <ul className="simple-list">
            {failures.map((r: any, i: number) => (
              <li key={i}>
                <div>
                  <b>{r.name} did not finish</b>
                  <small>
                    {r.workflow_name} · {day(r.created_at)}
                  </small>
                  {advanced && r.error && <small className="simple-detail">{r.error}</small>}
                </div>
                <button className="simple-button" onClick={() => onRun(r.run_id)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="simple-empty">{data ? 'No problems.' : 'Loading…'}</p>
        )}
      </section>

      {advanced && (
        <section className="simple-section">
          <div className="simple-toolbar">
            <h2>Breakdown</h2>
            <div className="simple-tabs" role="group" aria-label="Group usage by">
              {['Workflows', 'Agents', 'Models'].map((t) => (
                <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="simple-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>{tab === 'Workflows' ? 'Runs' : 'Calls'}</th>
                  <th>Tokens</th>
                  <th>{tab === 'Workflows' ? 'Total time' : 'Average time'}</th>
                  <th>Problems</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i}>
                    <td>
                      {tab === 'Workflows' && r.id ? (
                        <Link href={'/workflows/' + r.id}>{r.name}</Link>
                      ) : (
                        r.name || r.model
                      )}
                    </td>
                    <td>{number(r.runs ?? r.calls)}</td>
                    <td>{number(r.tokens)}</td>
                    <td>{(Number(r.duration_ms ?? r.avg_ms) / 1000).toFixed(1)}s</td>
                    <td className={r.failures ? 'stopped' : ''}>{number(r.failures)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="simple-empty">Nothing recorded in this range.</p>}
          </div>
          <p className="simple-note">
            Totals come from recorded steps. Test runs report zero tokens. Costs are estimates, not
            invoices.
          </p>
        </section>
      )}
    </div>
  );
}
function Billing({ usage }: { usage: any }) {
  return (
    <div className="studio-content studio-billing">
      <h1>ACCOUNT BILLING</h1>
      <div className="studio-billing-card">
        <div className="studio-billing-graphic">
          <CreditCard size={34} />
          <span>RELAY WORKSPACE</span>
          <b>Keep creating.</b>
          <small>No payment method connected</small>
        </div>
        <div>
          <span className="studio-soon">BILLING · PLANNED</span>
          <h2>
            A simple place for plans
            <br />
            and payments. Soon.
          </h2>
          <p>No charges, subscriptions, or payment collection are enabled in Relay.</p>
          <div className="studio-allowance">
            <Zap size={20} />
            <span>
              <b>{number(usage.balance)} test credits</b>
              <small>Local run allowance · no monetary value</small>
            </span>
          </div>
          <p className="studio-billing-note">
            Meta and SerpAPI usage may still be billed directly by those providers under your
            accounts.
          </p>
        </div>
      </div>
    </div>
  );
}
