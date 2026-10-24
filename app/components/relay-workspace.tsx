'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  Code2,
  CreditCard,
  FolderOpen,
  GitBranch,
  Layers,
  Loader2,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { AgentTreeWorkspace, TreeExecutionView } from './agent-trees';
import { RunWorkspace, ApiView } from './execution-details';
import { specialistTree, agentPresets } from '@/lib/agent-presets';
import './relay-workspace.css';

type Section = 'agents' | 'workflows' | 'usage' | 'billing';
const navigation = [
  { id: 'agents', name: 'Agents', icon: Bot },
  { id: 'workflows', name: 'Workflows', icon: GitBranch },
  { id: 'usage', name: 'Usage', icon: Activity },
  { id: 'billing', name: 'Billing', icon: CreditCard },
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
  const activePages = pages.filter((p) => !p.archived_at),
    activeRuns = data.runs.filter((r: any) => !stopped.includes(r.status)).length;
  return (
    <div className="studio-shell">
      <aside className="studio-sidebar">
        <Link href="/agents" className="studio-brand">
          <span className="studio-logo">
            <Layers size={21} />
          </span>
          relay<span className="studio-beta">BETA</span>
        </Link>
        <div className="studio-workspace">
          <span>H</span>
          <div>
            <b>{data.workspace.name}</b>
            <small>Personal workspace</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="studio-nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <Link
              key={item.id}
              href={'/' + item.id}
              className={section === item.id ? 'active' : ''}
            >
              <item.icon size={18} />
              {item.name}
              {item.id === 'workflows' && activeRuns > 0 && (
                <span className="studio-nav-count">{activeRuns}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="studio-pages-heading">
          <span>WORKFLOW PAGES</span>
          <button aria-label="Create workflow page" onClick={() => setCreate({})}>
            <Plus size={15} />
          </button>
        </div>
        <div className="studio-page-links">
          {activePages.slice(0, 7).map((w) => (
            <Link
              href={'/workflows/' + w.id}
              key={w.id}
              className={workflowId === w.id ? 'selected' : ''}
            >
              <span className={'page-dot ' + (w.active_count ? 'running' : '')} />
              <span>{w.name}</span>
            </Link>
          ))}
          {!activePages.length && <p>Your workflow pages live here.</p>}
          <Link className="studio-view-all" href="/workflows">
            All workflow pages <ArrowRight size={12} />
          </Link>
        </div>
        <div className="studio-sidebar-bottom">
          <div className="studio-environment">
            <i />
            {data.mode === 'live' ? 'Live execution' : 'Fixture mode'}
            <ShieldCheck size={13} />
          </div>
          <button onClick={() => setSettings('providers')}>
            <Settings2 size={16} />
            Workspace settings
          </button>
          <div className="studio-profile">
            <span>H</span>
            <div>
              <b>HackTX workspace</b>
              <small>Build something useful.</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="studio-body">
        <header className="studio-topbar">
          <div>
            <span>Workspace</span>
            <span>/</span>
            <b>{page?.name || navigation.find((n) => n.id === section)?.name}</b>
          </div>
          <div className="studio-top-actions">
            <span className="studio-mode">
              <i />
              {data.mode === 'live' ? 'Live' : 'Fixture'}
            </span>
            <button className="studio-api-button" onClick={() => setSettings('api')}>
              <Code2 size={15} />
              API access
            </button>
            <span className="studio-avatar">H</span>
          </div>
        </header>
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
          {section === 'agents' && (
            <AgentLibrary
              agents={data.agents}
              busy={busy}
              action={action}
              onUse={(a) => setCreate({ agent: a })}
              onSaved={() => setNotice('Agent saved. Published versions stay immutable.')}
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
    [filter, setFilter] = useState('All agents'),
    [selected, setSelected] = useState<any>(null),
    [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [instructions, setInstructions] = useState(''),
    [model, setModel] = useState(agents[0]?.draft.coordinatorModel || 'muse-spark-1.3'),
    [role, setRole] = useState<'reason' | 'research' | 'review'>('reason'),
    [web, setWeb] = useState(false);
  const key = useRef<string | null>(null);
  const visible = agents
    .filter((a) => !a.workflow_internal)
    .filter((a) =>
      [a.name, a.description, a.draft.instructions, a.draft.coordinatorModel]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .filter(
      (a) =>
        filter === 'All agents' ||
        (filter === 'My agents' && !a.id.startsWith('agt_preset')) ||
        (filter === 'Research' && a.draft.tools.includes('venue_search')) ||
        (filter === 'Writing' && /writ|copy/i.test(a.name)) ||
        (filter === 'Review' && /review/i.test(a.name)),
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
    setWeb(node?.tools.includes('venue_search') || false);
    key.current = null;
  }
  function reset() {
    setSelected(null);
    setName('');
    setDescription('');
    setInstructions('');
    setRole('reason');
    setWeb(false);
    key.current = null;
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
      throw new Error(
        'This is a full workflow template. Duplicate it into a workflow page to edit its tree.',
      );
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
  }
  const fullTemplate = selected && (!selected.draft.tree || selected.draft.tree.nodes.length > 2);
  return (
    <div className="studio-library-split">
      <section className="studio-library">
        <div className="studio-eyebrow">
          YOUR AGENT LIBRARY <span>{agents.length} agents</span>
        </div>
        <div className="studio-library-heading">
          <div>
            <h1>
              Good agents.
              <br />
              <span>Great possibilities.</span>
            </h1>
            <p>
              A specialist for every piece of the work.
              <br />
              Choose one, make it yours, and put it to work.
            </p>
          </div>
          <span className="studio-library-art">
            <Bot size={35} />
            <i>
              <Sparkles size={14} />
            </i>
          </span>
        </div>
        <div className="studio-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Search agent library"
            placeholder="Search agents, skills, or models…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>⌕</kbd>
        </div>
        <div className="studio-filter-tabs">
          {['All agents', 'Research', 'Writing', 'Review', 'My agents'].map((f) => (
            <button key={f} className={f === filter ? 'selected' : ''} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <div className="studio-library-section">
          <b>{search ? 'SEARCH RESULTS' : 'READY TO WORK'}</b>
          <small>{visible.length} agents</small>
        </div>
        <a className="studio-mobile-create" href="#agent-creation">
          <Plus size={14} />
          Create an agent
        </a>
        <div className="studio-agent-grid">
          {visible.map((a, i) => {
            const node = a.draft.tree?.nodes.find((n: any) => n.id !== 'user'),
              published = a.versions?.[0],
              legacy = a.draft.extractionProvider !== 'muse';
            return (
              <article
                className={'studio-agent-card ' + (selected?.id === a.id ? 'selected' : '')}
                key={a.id}
              >
                <button
                  className="studio-card-select"
                  aria-label={'Configure ' + a.name}
                  onClick={() => choose(a)}
                >
                  <div className="studio-card-top">
                    <span className={'studio-agent-symbol color-' + (i % 5)}>
                      {a.draft.tools.includes('venue_search') ? (
                        <Search size={21} />
                      ) : node?.mode === 'review' ? (
                        <ShieldCheck size={21} />
                      ) : (
                        <Bot size={21} />
                      )}
                    </span>
                    <span className="studio-card-kind">
                      {legacy
                        ? 'Legacy'
                        : a.draft.tree?.nodes.length > 2
                          ? 'Team'
                          : a.draft.tree
                            ? 'Specialist'
                            : 'Workflow'}
                    </span>
                    <MoreHorizontal size={18} />
                  </div>
                  <h3>{a.name}</h3>
                  <p>{a.description}</p>
                  <div className="studio-agent-capabilities">
                    <span>∞ {node?.model || a.draft.coordinatorModel}</span>
                    <span>
                      {a.draft.tools.includes('venue_search') ? 'Web search' : 'Text generation'}
                    </span>
                  </div>
                </button>
                <div className="studio-card-footer">
                  <span>
                    <i className={published ? 'published' : ''} />
                    {published ? 'Published · v' + published.version : 'Draft'}
                  </span>
                  <button disabled={!published || legacy} onClick={() => onUse(a)}>
                    Use agent <ArrowUpRight size={13} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {!visible.length && (
          <Empty title="No agents found">Try another name or clear your filters.</Empty>
        )}
        <div className="studio-library-note">
          <ShieldCheck size={15} />
          <span>Tools stay within your permissions. Every execution leaves a trace.</span>
        </div>
      </section>
      <aside className="studio-agent-editor" id="agent-creation">
        <div className="studio-editor-heading">
          <span className="studio-editor-icon">
            <Plus size={19} />
          </span>
          <div>
            <small>MAKE IT YOURS</small>
            <h2>{selected ? 'Configure agent' : 'Create an agent'}</h2>
          </div>
          {selected && (
            <button onClick={reset} aria-label="Create a new agent">
              <Plus size={16} />
            </button>
          )}
        </div>
        <p>Give your agent a purpose. You can add it to any workflow.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(() => save(true));
          }}
        >
          <label>
            Agent name
            <input
              required
              maxLength={150}
              placeholder="e.g. Community researcher"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Short description
            <input
              maxLength={500}
              placeholder="What does this agent do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="studio-label-row">
            <label htmlFor="agent-instructions">Instructions</label>
            <span>Be specific.</span>
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
          <div className="studio-editor-two">
            <label>
              Model
              <input
                required
                value={model}
                maxLength={100}
                onChange={(e) => setModel(e.target.value)}
              />
              <small>Meta Model API</small>
            </label>
            <label>
              Agent role
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as typeof role);
                  setWeb(e.target.value === 'research');
                }}
              >
                <option value="reason">Reason & write</option>
                <option value="research">Research</option>
                <option value="review">Review</option>
              </select>
            </label>
          </div>
          <div className="studio-permission">
            <span>
              <Network size={17} />
              <b>Web search</b>
              <small>SerpAPI · read only</small>
            </span>
            <input
              aria-label="Allow web search"
              type="checkbox"
              checked={web && role === 'research'}
              onChange={(e) => {
                setWeb(e.target.checked);
                setRole(e.target.checked ? 'research' : 'reason');
              }}
            />
          </div>
          {fullTemplate && (
            <div className="studio-alert">
              This template has a complete workflow. Use it to create a page and inspect its
              configuration there.
            </div>
          )}
          <div className="studio-editor-footer">
            <span>
              <ShieldCheck size={13} />
              Versioned & reusable
            </span>
            <div>
              <button
                type="button"
                disabled={
                  busy || fullTemplate || name.trim().length < 1 || instructions.trim().length < 20
                }
                onClick={() => void action(() => save(false))}
              >
                Save draft
              </button>
              <button
                className="primary"
                disabled={busy || fullTemplate || !name.trim() || instructions.trim().length < 20}
              >
                {busy ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}Publish agent
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>
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
  const [filter, setFilter] = useState('All workflows'),
    [search, setSearch] = useState('');
  const visible = pages
    .filter((p) => (filter === 'Archived' ? p.archived_at : !p.archived_at))
    .filter((p) => filter !== 'Running' || p.active_count > 0)
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="studio-content">
      <div className="studio-section-heading">
        <div>
          <div className="studio-eyebrow">YOUR WORK IN MOTION</div>
          <h1>Workflows</h1>
          <p>A page for every task. A clear view of every agent.</p>
        </div>
        <button className="primary" onClick={onCreate}>
          <Plus size={16} />
          New workflow
        </button>
      </div>
      <div className="studio-workflow-filters">
        <div className="studio-filter-tabs">
          {['All workflows', 'Running', 'Archived'].map((f) => (
            <button className={filter === f ? 'selected' : ''} onClick={() => setFilter(f)} key={f}>
              {f}
              {f === 'Archived' && <span>{pages.filter((p) => p.archived_at).length}</span>}
            </button>
          ))}
        </div>
        <div className="studio-search compact">
          <Search size={16} />
          <input
            aria-label="Search workflows"
            placeholder="Find a workflow…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="studio-workflow-grid">
        <button className="studio-new-page" onClick={onCreate}>
          <span>
            <Plus size={24} />
          </span>
          <h3>Create a workflow</h3>
          <p>Start with one agent or build a team.</p>
        </button>
        {visible.map((w) => (
          <article className="studio-workflow-card" key={w.id}>
            <Link href={'/workflows/' + w.id} className="studio-workflow-preview">
              <MiniTree tree={w.tree} active={!!w.active_count} />
              <span className="studio-preview-type">
                {w.kind === 'tree' ? 'Agent tree' : 'Single agent'}
              </span>
              <span className="studio-preview-status">
                <Tag status={w.archived_at ? 'archived' : w.latest_status || 'draft'} />
              </span>
            </Link>
            <div className="studio-workflow-card-info">
              <div>
                <Link href={'/workflows/' + w.id}>
                  <h3>{w.name}</h3>
                </Link>
                <button
                  aria-label={(w.archived_at ? 'Restore ' : 'Archive ') + w.name}
                  title={w.archived_at ? 'Restore page' : 'Archive page'}
                  disabled={busy}
                  onClick={() => onArchive(w)}
                >
                  <Archive size={15} />
                </button>
              </div>
              <p>{w.task || 'Ready for your next task.'}</p>
              <footer>
                <span>
                  {w.tree?.nodes?.length || 1} nodes · {w.run_count} runs
                </span>
                <span>Updated {day(w.updated_at)}</span>
              </footer>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && filter === 'Archived' && (
        <Empty title="No archived pages">
          Archived workflows stay here with their full run history.
        </Empty>
      )}
    </div>
  );
}
function MiniTree({ tree, active }: { tree: any; active: boolean }) {
  const n = Math.min(4, Math.max(1, (tree?.nodes?.length || 2) - 1));
  return (
    <div className={'studio-mini-tree ' + (active ? 'active' : '')}>
      <span className="mini-root">
        <Bot size={14} />
        <i>You</i>
      </span>
      <span className="mini-trunk" />
      <div>
        {Array.from({ length: n }, (_, i) => (
          <span className="mini-child" key={i}>
            <Bot size={12} />
            <b>{tree?.nodes?.[i + 1]?.name?.split(' ')[0] || 'Agent'}</b>
          </span>
        ))}
      </div>
    </div>
  );
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
    [task, setTask] = useState('');
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
  const max = Math.max(1, ...usage.chart.map((x: any) => x.steps));
  const rows = data
    ? tab === 'Workflows'
      ? data.workflows
      : tab === 'Agents'
        ? data.agents
        : tab === 'Models'
          ? data.models
          : data.failures
    : [];
  return (
    <div className="studio-content">
      <div className="studio-section-heading">
        <div>
          <div className="studio-eyebrow">MEASURED, NOT GUESSED</div>
          <h1>Usage & diagnostics</h1>
          <p>See where your agents spend their time and tokens.</p>
        </div>
        <div className="studio-usage-filters">
          <select
            aria-label="Usage date range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="all">All time</option>
          </select>
          <select
            aria-label="Usage execution mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="all">All executions</option>
            <option value="live">Live only</option>
            <option value="fixture">Fixtures only</option>
          </select>
        </div>
      </div>
      {error && <div className="studio-alert error">{error}</div>}
      <div className="studio-stat-grid">
        {[
          {
            label: 'Provider-reported tokens',
            value: number(data?.totals.tokens),
            sub: 'Fixture model calls report zero',
          },
          {
            label: 'Workflow runs',
            value: number(data?.totals.runs),
            sub: 'Runs with observed steps',
          },
          {
            label: 'Average step time',
            value: (Number(data?.totals.avg_ms || 0) / 1000).toFixed(1) + 's',
            sub: 'Observed model and tool latency',
          },
          {
            label: 'Failed steps',
            value: number(data?.totals.failures),
            sub: 'Open diagnostics for details',
          },
        ].map((item) => (
          <article key={item.label}>
            <span>
              {item.label}
              <Activity size={15} />
            </span>
            <strong>{data ? item.value : '—'}</strong>
            <small>{item.sub}</small>
          </article>
        ))}
      </div>
      <section className="studio-usage-chart">
        <div>
          <h2>Execution activity</h2>
          <span>Last 24 hours · all modes · completed steps</span>
          <small>PostgreSQL · actual observations</small>
        </div>
        {usage.chart.length ? (
          <div className="studio-bars">
            {usage.chart.map((x: any) => (
              <div key={x.bucket} title={`${x.steps} steps · ${x.tokens} tokens`}>
                <span style={{ height: Math.max(4, (x.steps / max) * 135) }} />
                <small>{new Date(x.bucket).getHours()}:00</small>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No completed steps yet">Your execution chart appears after a run.</Empty>
        )}
      </section>
      <section className="studio-diagnostics">
        <div className="studio-diagnostics-heading">
          <h2>Where it was used</h2>
          <span>
            {range === 'all' ? 'All time' : range === '7d' ? 'Last 7 days' : 'Last 24 hours'} ·{' '}
            {mode === 'all' ? 'all modes' : mode}
          </span>
        </div>
        <div className="studio-filter-tabs">
          {['Workflows', 'Agents', 'Models', 'Failures'].map((t) => (
            <button key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>
              {t}
              {t === 'Failures' && data?.failures.length > 0 && <span>{data.failures.length}</span>}
            </button>
          ))}
        </div>
        <div className="studio-table-wrap">
          <table>
            <thead>
              <tr>
                {(tab === 'Failures'
                  ? ['Step / workflow', 'Model', 'Error', 'Date']
                  : [
                      'Name',
                      tab === 'Workflows' ? 'Runs' : 'Calls',
                      'Tokens',
                      tab === 'Workflows' ? 'Total time' : 'Avg. time',
                      'Failed steps',
                    ]
                ).map((t) => (
                  <th key={t}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i}>
                  {tab === 'Failures' ? (
                    <>
                      <td>
                        <button onClick={() => onRun(r.run_id)}>
                          <b>{r.name}</b>
                          <small>{r.workflow_name}</small>
                        </button>
                      </td>
                      <td>
                        <code>{r.model}</code>
                      </td>
                      <td>{r.error || 'Step failed; inspect the run.'}</td>
                      <td>{day(r.created_at)}</td>
                    </>
                  ) : (
                    <>
                      <td>
                        {tab === 'Workflows' && r.id ? (
                          <Link href={'/workflows/' + r.id}>
                            {r.name}
                            <ArrowUpRight size={12} />
                          </Link>
                        ) : (
                          <b>{r.name || r.model}</b>
                        )}
                        {r.mode && <small>{r.mode}</small>}
                      </td>
                      <td>{number(r.runs ?? r.calls)}</td>
                      <td>{number(r.tokens)}</td>
                      <td>{(Number(r.duration_ms ?? r.avg_ms) / 1000).toFixed(1)}s</td>
                      <td>
                        <span className={r.failures ? 'studio-error-number' : ''}>
                          {number(r.failures)}
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty title={data ? 'No observations in this view' : 'Loading diagnostics…'}>
              {data
                ? 'Try another date range or execution mode.'
                : 'Reading persisted execution steps.'}
            </Empty>
          )}
        </div>
      </section>
      <p className="studio-usage-footnote">
        Totals come from recorded steps. Retries that fail before an observation is persisted can be
        missing. Cost estimates are not invoices.
      </p>
    </div>
  );
}
function Billing({ usage }: { usage: any }) {
  return (
    <div className="studio-content studio-billing">
      <div className="studio-eyebrow">WORKSPACE BILLING</div>
      <h1>Room to build.</h1>
      <p>Billing is not configured yet. Your workspace currently uses a local test allowance.</p>
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
