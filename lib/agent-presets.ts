import type { AgentTree } from './agent-tree';
export const agentPresets = [
  {
    id: 'research',
    name: 'Research analyst',
    description: 'Find web sources, compare evidence, and keep uncertain facts visible.',
    mode: 'research',
    instructions:
      'Research the user task through approved web search. Cite source IDs and URLs. Distinguish evidence from assumptions. Never invent a price, availability, or action.',
    tools: ['venue_search'],
    color: 'blue',
  },
  {
    id: 'writer',
    name: 'Thoughtful writer',
    description: 'Turn a rough brief into clear, welcoming copy.',
    mode: 'reason',
    instructions:
      'Write clear, useful copy for the user task. Match the audience and requested tone. Preserve known facts and flag missing details. Return a draft without claiming it was sent.',
    tools: [],
    color: 'violet',
  },
  {
    id: 'reviewer',
    name: 'Quality reviewer',
    description: 'Check a draft for gaps, weak claims, and inconsistencies.',
    mode: 'review',
    instructions:
      'Review the task and supplied results. Identify unsupported claims, inconsistencies, and practical gaps. Give concise corrections and distinguish blockers from optional improvements.',
    tools: [],
    color: 'green',
  },
  {
    id: 'planner',
    name: 'Project planner',
    description: 'Break a task into a practical plan with dependencies.',
    mode: 'reason',
    instructions:
      'Create a practical plan for the exact task. State dependencies, priorities, and unknowns. Respect budgets and deadlines. Do not claim that any plan step has been executed.',
    tools: [],
    color: 'amber',
  },
  {
    id: 'analyst',
    name: 'Data analyst',
    description: 'Explain supplied data, constraints, and tradeoffs.',
    mode: 'reason',
    instructions:
      'Analyze only the information supplied in the task. Explain patterns, calculations, and tradeoffs clearly. Do not invent datasets or claim to execute code. Flag missing evidence.',
    tools: [],
    color: 'rose',
  },
] as const;
export function specialistTree(value: {
  name: string;
  instructions: string;
  model: string;
  mode: 'reason' | 'research' | 'review';
  tools: 'venue_search'[];
}): AgentTree {
  return {
    complexity: 'simple',
    rationale: 'One specialist works under your root orchestrator.',
    nodes: [
      {
        id: 'user',
        parentId: null,
        name: 'You / Orchestrator',
        instructions:
          'Own the user task. Review the specialist result, preserve source references and unknowns, and return a concise useful answer.',
        provider: 'muse',
        model: value.model,
        mode: 'orchestrate',
        tools: [],
      },
      {
        id: 'specialist',
        parentId: 'user',
        name: value.name,
        instructions: value.instructions,
        provider: 'muse',
        model: value.model,
        mode: value.mode,
        tools: value.tools,
      },
    ],
  };
}
