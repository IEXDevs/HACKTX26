import { defaultConfig, workspaceId } from '../lib/config';
import { pool, tx } from '../lib/db';
export async function seed() {
  await tx(async (db) => {
    const ws = workspaceId();
    await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [
      ws,
      process.env.WORKSPACE_NAME || 'HackTX workspace',
    ]);
    await db.query(
      'INSERT INTO agents(id,workspace_id,name,description,draft) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [
        'agt_community',
        ws,
        'Community Event Operations',
        'Turn a brief into an evidence-backed event plan. Keep every write under human control.',
        defaultConfig,
      ],
    );
    await db.query(
      'INSERT INTO agent_versions(id,agent_id,workspace_id,version,config) VALUES($1,$2,$3,1,$4) ON CONFLICT DO NOTHING',
      ['ver_community_1', 'agt_community', ws, defaultConfig],
    );
    const readOnly = { ...defaultConfig, readOnly: true, tools: ['org_history', 'venue_search'] };
    await db.query(
      'INSERT INTO agents(id,workspace_id,name,description,draft) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [
        'agt_research',
        ws,
        'Community Research Assistant',
        'Short, read-only research tasks through the completion API.',
        readOnly,
      ],
    );
    await db.query(
      'INSERT INTO agent_versions(id,agent_id,workspace_id,version,config) VALUES($1,$2,$3,1,$4) ON CONFLICT DO NOTHING',
      ['ver_research_1', 'agt_research', ws, readOnly],
    );
    await db.query(
      'INSERT INTO credit_ledger(id,workspace_id,delta,reason,reference) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [
        'seed_' + ws,
        ws,
        Math.max(0, Math.min(10000, Number(process.env.INITIAL_TEST_CREDITS || 100))),
        'Labeled demonstration test-credit grant',
        'seed:' + ws,
      ],
    );
  });
}
if (process.argv[1]?.endsWith('seed.ts')) {
  await seed();
  console.log('Labeled templates and test credits seeded. No fabricated runs or telemetry.');
  await pool.end();
}
