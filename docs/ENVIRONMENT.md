# Environment configuration

The active stack uses Meta models, SerpAPI search, and Google Compute Engine hosting. Copy `.env.example` to `.env`. Keep secrets out of Git and `NEXT_PUBLIC_*` variables.

| Variable                                                      | Role                               | Value                                                                                                                   |
| ------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `RELAY_MODE`                                                  | All services                       | `fixture` for labeled synthetic responses; `live` for real calls. No silent fallback.                                   |
| `MUSE_API_KEY`                                                | Worker                             | Meta Model API bearer key.                                                                                              |
| `MUSE_BASE_URL`                                               | Worker                             | `https://api.meta.ai/v1`. Server configuration only.                                                                    |
| `MUSE_MODEL`                                                  | Template defaults                  | `muse-spark-1.3`. Existing versions retain their saved model IDs.                                                       |
| `SERPAPI_API_KEY`                                             | Connector                          | SerpAPI credential for web search.                                                                                      |
| `DATABASE_URL`                                                | Development or external PostgreSQL | Defaults to the local PGlite socket. Production Compose constructs its private PostgreSQL URL from `POSTGRES_PASSWORD`. |
| `RELAY_LOCAL_DB`                                              | Development supervisor             | `true` for PGlite; `false` for regular PostgreSQL. Production sets `false`.                                             |
| `RELAY_ARTIFACT_DIR`                                          | Connector                          | `.data/artifacts` locally; persistent connector volume in Compose.                                                      |
| `WORKSPACE_ID`, `WORKSPACE_NAME`                              | All services                       | Workspace identity; defaults to `hacktx-demo`, `HackTX workspace`.                                                      |
| `APP_URL`                                                     | Web and API examples               | Exact browser origin. Locally `http://127.0.0.1:3000`; HTTPS domain in production.                                      |
| `POSTGRES_PASSWORD`                                           | Production Compose                 | Required random hex password. Database has no published port.                                                           |
| `DASHBOARD_PASSWORD`                                          | Web                                | Required in production. Local loopback development bypasses sign-in when absent.                                        |
| `SESSION_SECRET`                                              | Web                                | Unique random value. Required in production.                                                                            |
| `CONNECTOR_SECRET`                                            | Web, worker, connector             | Different random value, at least 24 characters.                                                                         |
| `CONNECTOR_URL`                                               | Web, worker                        | Local `http://127.0.0.1:3101/mcp`; private service DNS in Compose.                                                      |
| `CONNECTOR_HOST`, `CONNECTOR_PORT`                            | Connector                          | Loopback, port 3101 locally. Compose binds within its private network.                                                  |
| `INITIAL_TEST_CREDITS`                                        | Seed                               | One-time local allowance, 100 by default. No payments or monetary value.                                                |
| `MODEL_INPUT_USD_PER_MILLION`, `MODEL_OUTPUT_USD_PER_MILLION` | Web, worker                        | Zero means unpriced. Configured values produce a rough blended estimate, not billing reconciliation.                    |
| `RELAY_DOMAIN`, `RELAY_IMAGE`                                 | Production Compose                 | Real HTTPS hostname and application image tag.                                                                          |
| `RELAY_HOSTING`                                               | Connection display                 | Compose sets `google-compute`. This is configuration, not proof of deployment.                                          |
| `RELAY_API_KEY`                                               | API examples and delegation client | Relay platform key. Separate from provider keys.                                                                        |
| `RELAY_VERSION_ID`, `DEMO_BRIEF`, `RELAY_IDEMPOTENCY_KEY`     | Native API example                 | Optional published version, brief, and retry key.                                                                       |

Only two external API credentials are needed for the active research workflow: `MUSE_API_KEY` and `SERPAPI_API_KEY`. Text-only trees need only Meta. Both extraction and coordination use Meta.

Restart services after changing environment values. Publish a new version after changing models or permissions. The production web process receives non-secret `MUSE_CONFIGURED` and `SERPAPI_CONFIGURED` flags; it receives neither provider key.

Gemini, Snowflake, Tiger Data, GCS, Solana, and Vultr are deferred. Their old environment variables are not needed. Historical schema, payment validation tests, and optional Timescale migration remain for compatibility; they are not active integrations.
