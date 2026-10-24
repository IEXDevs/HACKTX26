export function connections() {
  const fixture = process.env.RELAY_MODE !== 'live';
  const state = (ready: boolean) =>
    fixture ? 'fixture' : ready ? 'configured · unverified' : 'unavailable';
  return [
    {
      name: 'Gemini',
      role: 'Extract requirements from text, flyers, and PDFs',
      scope: 'Model inference; private input only',
      state: state(!!process.env.GEMINI_API_KEY || process.env.GEMINI_CONFIGURED === 'true'),
      proof: 'Live proof requires a successful extract step.',
    },
    {
      name: 'Muse Spark',
      role: 'Coordinate the bounded read-tool loop and produce a cited plan',
      scope: 'Approved tools only; no write access from the model',
      state: state(!!process.env.MUSE_API_KEY || process.env.MUSE_CONFIGURED === 'true'),
      proof: 'Live proof requires successful coordinator steps.',
    },
    {
      name: 'SerpAPI',
      role: 'Research venue source evidence',
      scope: 'Google search, read only',
      state: state(!!process.env.SERPAPI_API_KEY || process.env.SERPAPI_CONFIGURED === 'true'),
      proof: 'Run evidence includes search IDs and source links.',
    },
    {
      name: 'Snowflake',
      role: 'Organization history and opted-in preference aggregates',
      scope: 'Parameterized, workspace-filtered SELECT on RELAY_ORG_CONTEXT',
      state: state(
        (!!process.env.SNOWFLAKE_ACCOUNT && !!process.env.SNOWFLAKE_TOKEN) ||
          process.env.SNOWFLAKE_CONFIGURED === 'true',
      ),
      proof:
        'Run evidence includes source row IDs and statement handle. No application telemetry is sent here.',
    },
    {
      name: 'Tiger Data',
      role: 'System of record and execution time-series queries',
      scope: 'PostgreSQL; optional TimescaleDB hypertable',
      state:
        process.env.TIMESCALE_ENABLED === 'true'
          ? 'configured · unverified'
          : 'local PostgreSQL · Tiger Data unavailable',
      proof:
        'Usage chart reads execution_metrics. Tiger Data proof requires the managed database and Timescale migration.',
    },
    {
      name: 'Google Cloud Storage',
      role: 'Private input briefs and approved output artifacts',
      scope: 'Private bucket objects; create-only writes with stable action IDs',
      state: state(!!process.env.GCS_BUCKET || process.env.GCS_CONFIGURED === 'true'),
      proof: 'Approved artifact records include private gs:// references.',
    },
    {
      name: 'Solana',
      role: 'Devnet-only test usage credits',
      scope: 'Verify finalized transactions and invoice memo; no wallet custody',
      state: process.env.SOLANA_RECIPIENT ? 'configured · unverified' : 'unavailable',
      proof: 'Credits require a verified devnet genesis hash, transfer and workspace invoice.',
    },
    {
      name: 'MCP',
      role: 'Private connector boundary and API delegation tools',
      scope: 'Official TypeScript SDK; tool schemas and runtime allowlists',
      state: 'implemented',
      proof: 'Worker calls connector tools over Streamable HTTP. Probe with npm run test:e2e.',
    },
    {
      name: 'Vultr',
      role: 'One VM runs web/API, worker, connectors, and TLS proxy',
      scope: 'Docker Compose deployment',
      state: 'deployment prepared',
      proof: 'No VM deployment has been performed by this build.',
    },
  ];
}
