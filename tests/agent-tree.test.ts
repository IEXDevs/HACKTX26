import { describe, it, expect } from 'vitest';
import {
  defaultTree,
  descendants,
  executionOrder,
  layoutTree,
  planFixtureTree,
  treeDefinitionSchema,
} from '../lib/agent-tree';
import { agentConfigSchema, defaultConfig } from '../lib/config';

describe('bounded manual and adaptive agent trees', () => {
  it('adapts the fixture proposal to task complexity without claiming a model call', () => {
    const simple = planFixtureTree('Summarize a short paragraph.', 'auto');
    const complex = planFixtureTree(
      'Plan and research an accessible community event, compare venues, budget and schedule, review risks and sources, and create evidence-backed invitation drafts.',
      'auto',
    );
    expect(simple.nodes).toHaveLength(2);
    expect(complex.nodes).toHaveLength(7);
    expect(complex.rationale).toContain('No planning model was called');
    expect(simple.nodes[0].id).toBe('user');
  });
  it('rejects cycles, missing parents, duplicate IDs and unbounded branches', () => {
    const cycle = defaultTree();
    cycle.nodes[1].parentId = 'venues';
    cycle.nodes[4].parentId = 'requirements';
    expect(treeDefinitionSchema.safeParse(cycle).success).toBe(false);
    const missing = defaultTree();
    missing.nodes[1].parentId = 'missing';
    expect(treeDefinitionSchema.safeParse(missing).success).toBe(false);
    const duplicate = defaultTree();
    duplicate.nodes[1].id = 'user';
    expect(treeDefinitionSchema.safeParse(duplicate).success).toBe(false);
    const large = defaultTree();
    while (large.nodes.length < 10)
      large.nodes.push({ ...large.nodes[1], id: 'extra_' + large.nodes.length });
    expect(treeDefinitionSchema.safeParse(large).success).toBe(false);
  });
  it('keeps read permissions explicit and rejects writes or a model budget below the tree size', () => {
    const tree = defaultTree();
    const config = {
      ...defaultConfig,
      workflowKind: 'tree',
      tree,
      outputFormat: 'agent_tree_json',
      tools: ['org_history', 'venue_search'],
    };
    expect(agentConfigSchema.safeParse(config).success).toBe(true);
    expect(agentConfigSchema.safeParse({ ...config, tools: ['venue_search'] }).success).toBe(false);
    expect(agentConfigSchema.safeParse({ ...config, maxModelCalls: 2 }).success).toBe(false);
    expect(
      agentConfigSchema.safeParse({ ...config, tools: [...config.tools, 'publish_page'] }).success,
    ).toBe(false);
    tree.nodes[1].tools = ['venue_search'];
    expect(treeDefinitionSchema.safeParse(tree).success).toBe(false);
  });
  it('orders descendants before their parent synthesis and lays out each node below its parent', () => {
    const tree = defaultTree();
    const order = executionOrder(tree);
    expect(order.at(-1)?.id).toBe('user');
    expect(order.findIndex((n) => n.id === 'venues')).toBeLessThan(
      order.findIndex((n) => n.id === 'evidence_lead'),
    );
    expect([...descendants(tree, 'evidence_lead')].sort()).toEqual([
      'context',
      'evidence_lead',
      'venues',
    ]);
    const layout = layoutTree(tree);
    for (const n of tree.nodes)
      if (n.parentId)
        expect(layout.positions[n.id].y).toBeGreaterThan(layout.positions[n.parentId].y);
  });
});
