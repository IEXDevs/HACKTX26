// Usage chart view model. Placeholder values until the diagnostics API returns
// token totals per time bucket and per agent type for the selected range.
export type UsageRange = '24h' | '7d' | 'all';
export type TokenPoint = { at: string; label: string; tokens: number };
export type AgentShare = { id: string; name: string; tokens: number };
export type WorkflowShare = { id: string; name: string; tokens: number };
export type UsageCharts = {
  overTime: TokenPoint[];
  byAgent: AgentShare[];
  byWorkflow: WorkflowShare[];
};

const hourly = [
  1.2, 0.8, 0.4, 0.2, 0.1, 0, 0, 0.3, 1.1, 2.4, 3.8, 4.6, 3.9, 5.2, 6.8, 6.1, 4.4, 3.6, 5.1, 7.4,
  6.6, 4.8, 3.2, 2.1,
];
const daily = [38, 52, 44, 61, 73, 29, 66];
const weekly = [120, 180, 150, 240, 310, 280, 360, 342];

function points(values: number[], step: number, unitMs: number, format: (d: Date) => string) {
  const now = Date.now();
  return values.map((v, i) => {
    const at = new Date(now - (values.length - 1 - i) * unitMs);
    return { at: at.toISOString(), label: format(at), tokens: Math.round(v * step) };
  });
}

export function placeholderUsageCharts(range: UsageRange): UsageCharts {
  const overTime =
    range === '24h'
      ? points(hourly, 1000, 3600e3, (d) => d.getHours() + ':00')
      : range === '7d'
        ? points(daily, 1000, 86400e3, (d) => d.toLocaleDateString(undefined, { weekday: 'short' }))
        : points(weekly, 1000, 7 * 86400e3, (d) =>
            d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          );
  const total = overTime.reduce((sum, p) => sum + p.tokens, 0);
  // Stable library order, so each agent keeps its chart color across ranges.
  const agents = [
    ['agt-research', 'Research analyst', 0.31],
    ['agt-venue', 'Venue researcher', 0.22],
    ['agt-writer', 'Thoughtful writer', 0.19],
    ['agt-reviewer', 'Quality reviewer', 0.12],
    ['agt-planner', 'Project planner', 0.09],
    ['agt-data', 'Data analyst', 0.07],
  ] as const;
  const workflows = [
    ['wf-community', 'Community event team', 0.38],
    ['wf-meetup', 'Meetup planning', 0.22],
    ['wf-recap', 'Weekly recap', 0.14],
    ['wf-speakers', 'Speaker outreach', 0.11],
    ['wf-welcome', 'Welcome email', 0.08],
    ['wf-venues', 'Venue shortlist', 0.04],
    ['wf-vendor', 'Vendor research', 0.03],
  ] as const;
  return {
    overTime,
    byAgent: agents.map(([id, name, share]) => ({ id, name, tokens: Math.round(total * share) })),
    byWorkflow: workflows.map(([id, name, share]) => ({
      id,
      name,
      tokens: Math.round(total * share),
    })),
  };
}
