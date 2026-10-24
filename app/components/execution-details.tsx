'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { AgentTreeWorkspace, TreeExecutionView } from './agent-trees';
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
        {node(
          'extract',
          'Extract requirements',
          run?.config.extractionModel || 'Muse Spark',
          Sparkles,
        )}
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
                {node('tool_0', 'Venue evidence', 'SerpAPI · scoped search', Globe, 'tool')}
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
export function RunWorkspace({
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
            run.output.options ? (
              <PlanOutput plan={run.output} run={run} />
            ) : (
              <Json value={run.output} />
            )
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
export function ApiView({
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
