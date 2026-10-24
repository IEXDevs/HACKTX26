# Environment configuration

Copy `.env.example` to `.env`. Keep it out of Git. No credential uses a `NEXT_PUBLIC_` variable.

| Variable                                                      | Role                                | Default / requirement                                                                |
| ------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `RELAY_MODE`                                                  | All processes                       | `fixture`; set `live` explicitly for real model/source calls                         |
| `DATABASE_URL`                                                | Web, worker, connectors, migrations | Local PostgreSQL URL; use Tiger Data TLS URL in production                           |
| `RELAY_LOCAL_DB`                                              | Dev supervisor / pool tuning        | Local embedded database unless `false`                                               |
| `TIMESCALE_ENABLED`                                           | Migration and Usage                 | `false` locally; `true` for TimescaleDB hypertable and `time_bucket` query           |
| `WORKSPACE_ID`, `WORKSPACE_NAME`                              | Application identity                | `hacktx-demo`, `HackTX workspace`                                                    |
| `APP_URL`                                                     | CSRF checks / API examples          | Exact browser origin, including scheme and port. Production must use HTTPS.          |
| `DASHBOARD_PASSWORD`                                          | Web only                            | Required in production; local loopback development bypass when absent                |
| `SESSION_SECRET`                                              | Web only                            | Unique random secret; required in production                                         |
| `CONNECTOR_SECRET`                                            | Web, worker, connector              | Different random secret of at least 24 characters                                    |
| `CONNECTOR_URL`                                               | Web and worker                      | Local `http://127.0.0.1:3101/mcp`; Compose uses private service DNS                  |
| `CONNECTOR_HOST`, `CONNECTOR_PORT`                            | Connector                           | Loopback and 3101 locally; internal Docker network in production                     |
| `GEMINI_API_KEY`, `GEMINI_MODEL`                              | Worker only                         | Real Gemini key; configurable model, initially `gemini-2.5-flash`                    |
| `MUSE_API_KEY`, `MUSE_MODEL`                                  | Worker only                         | Meta Model API bearer key; initially `muse-spark-1.3`                                |
| `MUSE_BASE_URL`                                               | Worker only                         | `https://api.meta.ai/v1`; server configuration only                                  |
| `SERPAPI_API_KEY`                                             | Connector only                      | Real SerpAPI credential                                                              |
| `SNOWFLAKE_ACCOUNT`                                           | Connector only                      | Account hostname prefix; do not include `.snowflakecomputing.com`                    |
| `SNOWFLAKE_TOKEN`                                             | Connector only                      | OAuth bearer token scoped to a read-only role                                        |
| `SNOWFLAKE_DATABASE`, `SNOWFLAKE_SCHEMA`                      | Connector only                      | `RELAY`, `PUBLIC`; contains `RELAY_ORG_CONTEXT` view                                 |
| `SNOWFLAKE_WAREHOUSE`                                         | Connector only                      | SQL warehouse allowed for the connector role                                         |
| `GCS_BUCKET`                                                  | Connector only                      | Private bucket name; enable uniform bucket-level access and public access prevention |
| `GOOGLE_APPLICATION_CREDENTIALS`                              | Connector / Compose secret          | External service account JSON path; do not put the file in this repository           |
| `SOLANA_RPC_URL`                                              | Web only                            | `https://api.devnet.solana.com`; genesis check prevents mainnet crediting            |
| `SOLANA_RECIPIENT`                                            | Web only                            | Your devnet public key; required to issue invoices                                   |
| `INITIAL_TEST_CREDITS`                                        | Seed only                           | One-time demo grant, 100 by default; seed is idempotent                              |
| `MODEL_INPUT_USD_PER_MILLION`, `MODEL_OUTPUT_USD_PER_MILLION` | Web / worker                        | Zero means unpriced. Estimates use a rough blended rate, not an invoice.             |
| `RELAY_DOMAIN`                                                | Compose / Caddy                     | Your registered `.tech` domain; placeholder is not a registration claim              |
| `RELAY_IMAGE`                                                 | Compose                             | `relay:local`; tag or pin the built image for deployment                             |
| `RELAY_API_KEY`                                               | Example / delegation client         | Platform key created in the dashboard, distinct from all provider keys               |
| `RELAY_VERSION_ID`, `DEMO_BRIEF`, `RELAY_IDEMPOTENCY_KEY`     | Native API example                  | Optional published version, brief, and retry key                                     |

The production web process receives non-secret `*_CONFIGURED` flags for connection display. It does not receive model, Snowflake, SerpAPI, or GCS credentials. These flags indicate configuration presence only. Inspect live run evidence for proof.

Restart the worker after changing environment values. Publish a new agent version after changing its model identifiers. Environment defaults do not mutate an existing version.
