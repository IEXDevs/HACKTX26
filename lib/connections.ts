export function connections() {
  const fixture = process.env.RELAY_MODE !== 'live';
  const state = (ready: boolean) =>
    fixture ? 'fixture' : ready ? 'configured · unverified' : 'unavailable';
  return [
    {
      name: 'Meta / Muse Spark',
      role: 'Extract briefs, plan trees, run every agent, and coordinate search',
      scope: 'Model inference; tools remain enforced by Relay',
      state: state(!!process.env.MUSE_API_KEY || process.env.MUSE_CONFIGURED === 'true'),
      proof:
        'Inspect successful live model steps and their reported usage. A configured key alone is not proof.',
    },
    {
      name: 'SerpAPI',
      role: 'Web research and source evidence',
      scope: 'Google search, read only',
      state: state(!!process.env.SERPAPI_API_KEY || process.env.SERPAPI_CONFIGURED === 'true'),
      proof: 'Live tool results include search IDs, excerpts, and source URLs.',
    },
    {
      name: 'PostgreSQL',
      role: 'Versions, runs, approvals, events, and local test allowance',
      scope: 'Private database; execution chart uses actual date_trunc queries',
      state:
        process.env.RELAY_LOCAL_DB === 'false' ? 'configured · unverified' : 'local development',
      proof:
        'Refresh a run to inspect persisted events. The production Compose stack uses regular PostgreSQL on the VM.',
    },
    {
      name: 'Private file storage',
      role: 'Input briefs and exact approved artifacts',
      scope: 'Connector-only persistent disk; atomic create-only writes',
      state: 'implemented',
      proof:
        'Live artifacts use local:// references. Fixture files retain fixture:// labels. Verify VM disk persistence after deployment.',
    },
    {
      name: 'Google Cloud hosting',
      role: 'One Compute Engine VM runs the Docker Compose stack',
      scope: 'HTTPS web/API; private worker, database, and MCP connector',
      state:
        process.env.RELAY_HOSTING === 'google-compute'
          ? 'deployment configured · unverified'
          : 'deployment prepared',
      proof:
        'Deployment instructions are prepared. No Google Cloud VM has been provisioned or verified by this build.',
    },
    {
      name: 'MCP',
      role: 'Trusted search and storage boundary; delegation tools',
      scope: 'Official TypeScript SDK with validated tool arguments',
      state: 'implemented',
      proof:
        'Worker uses Streamable HTTP. API delegation exposes start_agent_run and get_agent_run.',
    },
  ];
}
