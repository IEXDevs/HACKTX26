# One-VM deployment on Vultr

This is a prepared deployment path. No VM, domain, or paid service was provisioned by this build. Docker is unavailable on the build host, so container startup has not been tested here.

## Prepare infrastructure

1. Use a Vultr VM with Ubuntu and the official Docker Engine / Compose plugin. Size it for a Next.js production build plus three Node processes. The models run through provider APIs; a local GPU is unnecessary. Follow [Vultr's current Docker guide](https://docs.vultr.com/how-to-install-docker-on-ubuntu-24-04).
2. Use a Tiger Data PostgreSQL service as the system of record. Restrict its network access to the VM. Use the provider's TLS connection string and certificate requirements. Do not disable certificate verification. Enable `TIMESCALE_ENABLED=true` for the hypertable migration.
3. Point your registered `.tech` domain's DNS record at the VM. Set `RELAY_DOMAIN` to that hostname. Relay does not register or purchase a domain.
4. Open only SSH from your administration network and ports 80/443 for the app. Do not publish the worker, PostgreSQL, or MCP connector ports.
5. Create a private GCS bucket. Enable public access prevention and uniform bucket-level access. Grant a dedicated service account only the needed object create/read access. Place its JSON file outside this checkout on the VM. Docker mounts it as a connector-only secret. Do not commit it.
6. Prepare Snowflake's read-only organization context view. Load `db/snowflake-demo.sql` only if you want labeled synthetic records. Use a connector role that can select the view and use its warehouse. Supply an OAuth token. Refresh it before a live demo if necessary.

## Configure and start

```sh
git clone https://github.com/IEXDevs/HACKTX26.git relay
cd relay
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
```

Put the two different random values into `SESSION_SECRET` and `CONNECTOR_SECRET`. Set a strong `DASHBOARD_PASSWORD`. Set the database URL, domain, private external credentials path, provider keys, `RELAY_LOCAL_DB=false`, and `TIMESCALE_ENABLED=true`.

The production Compose file keeps model credentials in the worker and data-provider credentials in the trusted connector. The web receives only platform/session secrets, the internal MCP secret, database access, devnet configuration, and non-secret connection flags. The Docker build ignores `.env`, `.data`, Git history, and credential files. Keep credentials outside the project so future file additions cannot include them in the image.

For a deployed fixture demonstration, leave `RELAY_MODE=fixture`. The Compose GCS secret declaration still needs an external JSON file; use an external file containing `{}` for fixture-only deployment. Replace it with actual credentials before enabling live storage. This empty file is not a provider credential or a proof of GCS use.

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 migrate worker connectors web
```

The one-shot migration service applies the schema and idempotent seed. Connectors start on the private Docker network. The web starts only after migrations and the connector health check. Caddy exposes the web on 80/443 and obtains TLS for the configured domain. Caddy's [request body limit](https://caddyserver.com/docs/caddyfile/directives/request_body) is set to 8 MB, and its proxy disables SSE response buffering.

Sign in at your HTTPS domain. Create a scoped platform key. Publish a version with model identifiers available to your accounts. Complete one live workflow before claiming integrations work.

## Verify the deployment

- Start the saved Community Event Operations agent from the dashboard. Confirm requirements. Inspect real model steps, Snowflake row IDs, and the SerpAPI search ID.
- Keep unknown venue facts unresolved. Confirm each exact write separately.
- Restart the worker while a run waits for approval: `docker compose restart worker`. Refresh. The same pending action and content hash must remain.
- After review, approve a write and inspect its private GCS object reference. Do not make that object public.
- Use `npm run demo:api` from a client with the same published version ID and workspace key. Review actions in the dashboard or its explicit CLI approval prompts.
- Check Usage. With `TIMESCALE_ENABLED=true`, its query indicator must show `time_bucket`. The plotted records must correspond to completed run steps.
- For a real devnet proof, create an invoice, sign the exact transfer and memo from your wallet, wait for finalization, and verify it. Retry verification; the balance must increase once.

## Operations

Tag and retain the deployed application image. Keep managed database backups and GCS retention settings. Use `docker compose logs` for process faults. Health checks validate web/database reachability and connector liveness, not provider credentials. A paused run needs no worker slot. After an executing worker dies, another worker can recover its expired lease within 90 seconds.

The first prototype uses a single shared workspace password. Add identity, rate limits, password throttling, user roles, retention controls, and workload budgets before exposing it as a public service. Do not treat the demonstration participant cookie as identity.
