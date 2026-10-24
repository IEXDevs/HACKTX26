import { z } from 'zod';

export const treeNodeSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
    parentId: z.string().nullable(),
    name: z.string().min(1).max(70),
    instructions: z.string().min(10).max(3000),
    provider: z.enum(['muse', 'gemini']),
    model: z.string().min(1).max(100),
    mode: z.enum(['orchestrate', 'reason', 'research', 'review']),
    tools: z.array(z.enum(['org_history', 'venue_search'])).max(2),
  })
  .strict();
export const treeDefinitionSchema = z
  .object({
    complexity: z.enum(['simple', 'standard', 'complex']),
    rationale: z.string().min(1).max(1200),
    nodes: z.array(treeNodeSchema).min(1).max(9),
  })
  .strict()
  .superRefine((tree, ctx) => {
    const ids = new Set(tree.nodes.map((n) => n.id));
    const roots = tree.nodes.filter((n) => n.parentId === null);
    if (ids.size !== tree.nodes.length)
      ctx.addIssue({ code: 'custom', message: 'Every node needs a unique identifier.' });
    if (roots.length !== 1 || roots[0]?.id !== 'user' || roots[0]?.mode !== 'orchestrate')
      ctx.addIssue({
        code: 'custom',
        message: 'The tree needs one user/orchestrator root with id user.',
      });
    if (roots[0] && roots[0].instructions.length < 20)
      ctx.addIssue({
        code: 'custom',
        message: 'The root instructions need at least twenty characters.',
      });
    for (const node of tree.nodes) {
      if (node.parentId !== null && !ids.has(node.parentId))
        ctx.addIssue({ code: 'custom', message: `Missing parent for ${node.name}.` });
      if (new Set(node.tools).size !== node.tools.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate tool permissions are not allowed.' });
      if (node.mode !== 'research' && node.tools.length)
        ctx.addIssue({ code: 'custom', message: 'Only research nodes may call read tools.' });
      if (node.mode === 'research' && !node.tools.length)
        ctx.addIssue({
          code: 'custom',
          message: 'A research node needs at least one allowed read tool.',
        });
      let current: typeof node | undefined = node;
      const visited = new Set<string>();
      while (current) {
        if (visited.has(current.id)) {
          ctx.addIssue({ code: 'custom', message: 'Agent connections must not contain a cycle.' });
          break;
        }
        visited.add(current.id);
        if (visited.size > 5) {
          ctx.addIssue({ code: 'custom', message: 'Keep the tree within five levels.' });
          break;
        }
        current =
          current.parentId === null
            ? undefined
            : tree.nodes.find((n) => n.id === current!.parentId);
      }
    }
    if (tree.nodes.reduce((total, n) => total + n.tools.length, 0) > 12)
      ctx.addIssue({
        code: 'custom',
        message: 'A tree can contain at most twelve read-tool calls.',
      });
  });
export type AgentTree = z.infer<typeof treeDefinitionSchema>;
export type TreeNode = z.infer<typeof treeNodeSchema>;
export type TreeMode = TreeNode['mode'];
export const modeLabels: Record<TreeMode, string> = {
  orchestrate: 'Orchestrate',
  reason: 'Reason',
  research: 'Research',
  review: 'Review',
};
export const modeDescriptions: Record<TreeMode, string> = {
  orchestrate: 'Combine child results and return a clear answer. No external writes.',
  reason: 'Solve a focused subtask using the task and previous results. No tool access.',
  research: 'Retrieve evidence through the selected approved read tools, then summarize it.',
  review: 'Check previous results for gaps, conflicts, unsupported claims, and open questions.',
};
export function executionOrder(tree: AgentTree): TreeNode[] {
  const result: TreeNode[] = [];
  function visit(id: string) {
    for (const child of tree.nodes.filter((n) => n.parentId === id)) visit(child.id);
    result.push(tree.nodes.find((n) => n.id === id)!);
  }
  visit('user');
  return result;
}
export function descendants(tree: AgentTree, nodeId: string): Set<string> {
  const found = new Set<string>([nodeId]);
  let previous = 0;
  while (previous !== found.size) {
    previous = found.size;
    tree.nodes.forEach((n) => {
      if (n.parentId && found.has(n.parentId)) found.add(n.id);
    });
  }
  return found;
}
export function layoutTree(tree: AgentTree) {
  let leaf = 0;
  const positions: Record<string, { x: number; y: number }> = {};
  function place(id: string, depth: number): number {
    const children = tree.nodes.filter((n) => n.parentId === id);
    const xs = children.map((n) => place(n.id, depth + 1));
    const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : 140 + leaf++ * 270;
    positions[id] = { x, y: 55 + depth * 175 };
    return x;
  }
  place('user', 0);
  const width = Math.max(720, leaf * 270 + 20);
  const offset = (width - (leaf * 270 + 20)) / 2;
  Object.values(positions).forEach((p) => {
    p.x += offset;
  });
  return {
    positions,
    width,
    height: Math.max(610, ...Object.values(positions).map((p) => p.y + 180)),
  };
}
export function defaultTree(
  models = { muse: 'muse-spark-1.3', gemini: 'gemini-2.5-flash' },
): AgentTree {
  return {
    complexity: 'standard',
    rationale:
      'A focused team separates understanding, evidence, and review. The orchestrator combines the results.',
    nodes: [
      {
        id: 'user',
        parentId: null,
        name: 'You / Orchestrator',
        instructions:
          'Coordinate this task. Combine specialist results, cite attached evidence, and keep unknown details explicit.',
        provider: 'muse',
        model: models.muse,
        mode: 'orchestrate',
        tools: [],
      },
      {
        id: 'requirements',
        parentId: 'user',
        name: 'Requirements analyst',
        instructions:
          'Identify the task requirements, constraints, budget, audience, and unanswered questions. Do not invent details.',
        provider: 'gemini',
        model: models.gemini,
        mode: 'reason',
        tools: [],
      },
      {
        id: 'evidence_lead',
        parentId: 'user',
        name: 'Evidence & quality lead',
        instructions:
          'Review the research results against the task. Compare evidence, flag unsupported claims, and recommend the next steps.',
        provider: 'muse',
        model: models.muse,
        mode: 'review',
        tools: [],
      },
      {
        id: 'context',
        parentId: 'evidence_lead',
        name: 'Community context',
        instructions:
          'Read organization history and opted-in community preferences. Summarize the evidence relevant to this task.',
        provider: 'muse',
        model: models.muse,
        mode: 'research',
        tools: ['org_history'],
      },
      {
        id: 'venues',
        parentId: 'evidence_lead',
        name: 'Venue researcher',
        instructions:
          'Research venue options for the exact task. Keep prices, availability, capacity and accessibility unconfirmed unless verified.',
        provider: 'gemini',
        model: models.gemini,
        mode: 'research',
        tools: ['venue_search'],
      },
    ],
  };
}
export function planFixtureTree(
  task: string,
  complexity: 'auto' | 'simple' | 'standard' | 'complex',
  models?: { muse: string; gemini: string },
): AgentTree {
  const lower = task.toLowerCase();
  const score =
    (task.length > 350 ? 2 : 0) +
    (task.match(
      /\b(compare|research|budget|risk|sources|evidence|venue|schedule|integrat|deploy|review|plan)\w*/gi,
    )?.length || 0) +
    (task.match(/\band\b|[,;]/gi)?.length || 0);
  const level =
    complexity === 'auto'
      ? score >= 8
        ? 'complex'
        : score >= 3
          ? 'standard'
          : 'simple'
      : complexity;
  const base = defaultTree(models);
  base.complexity = level;
  base.rationale = `Fixture heuristic: ${level} complexity from ${task.length} characters and ${score} constraint/research signals${complexity === 'auto' ? '' : '; organizer selected the complexity'}. No planning model was called.`;
  if (level === 'simple')
    base.nodes = [
      base.nodes[0],
      {
        ...base.nodes[1],
        name: 'Task specialist',
        instructions:
          'Answer the focused task directly. Identify any missing information. Do not claim to take external actions.',
      },
    ];
  if (!/event|meetup|venue|community|organizer/i.test(lower) && level !== 'simple') {
    base.nodes = base.nodes.map((n) =>
      n.id === 'context'
        ? {
            ...n,
            name: 'Constraints analyst',
            mode: 'reason' as const,
            tools: [],
            instructions:
              'Analyze constraints and practical tradeoffs for this task. Do not claim tools or file changes.',
          }
        : n.id === 'venues'
          ? {
              ...n,
              name: 'Solution specialist',
              mode: 'reason' as const,
              tools: [],
              instructions:
                'Develop a solution draft for this task. Use earlier results, state assumptions, and do not claim code execution or external changes.',
            }
          : n,
    );
  }
  if (level === 'complex')
    base.nodes.push(
      {
        id: 'risks',
        parentId: 'evidence_lead',
        name: 'Risk & gaps analyst',
        instructions:
          'Identify unresolved details, unsupported assumptions, operational risks, and the checks needed before action.',
        provider: 'muse',
        model: base.nodes[0].model,
        mode: 'review',
        tools: [],
      },
      {
        id: 'delivery',
        parentId: 'user',
        name: 'Delivery planner',
        instructions:
          'Turn the specialist findings into a concise proposed plan with dependencies and clear next steps. Do not take external actions.',
        provider: 'muse',
        model: base.nodes[0].model,
        mode: 'reason',
        tools: [],
      },
    );
  return treeDefinitionSchema.parse(base);
}
