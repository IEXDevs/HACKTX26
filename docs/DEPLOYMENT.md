# Google Cloud deployment

Target: one Google Compute Engine Linux VM running Docker Compose. The VM hosts the Next.js web/API, separate worker, private MCP connector, PostgreSQL, Caddy, and private artifact files. No VM has been provisioned by this build. Docker is unavailable on the development host, so container startup remains unverified.

This keeps the current durable polling worker. It avoids an additional queue service or managed database while the prototype is small. The database and files require persistent disks and backups; containers alone do not provide disaster recovery.

## Prepare the VM

1. Create a Compute Engine VM with enough memory for the Next.js production build and the runtime services. No GPU is needed; Meta hosts inference. Follow [Google's container deployment guidance](https://docs.cloud.google.com/compute/docs/containers/deploying-containers). Install Docker Engine and the Compose plugin using [Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
2. Keep Docker's data directory on persistent VM storage. The named volumes store PostgreSQL data, artifacts, and TLS state. Back them up. Do not use `docker compose down --volumes` unless you intend to erase them.
3. Point a domain's DNS record to the VM's reserved external IP. A `.tech` domain remains optional. Set `RELAY_DOMAIN` to that hostname.
4. Allow web traffic on 80 and 443. Restrict SSH to your administration access path. Do not open 3000, 3101, or 5432. Only Caddy publishes application ports.

## Configure

```sh
git clone https://github.com/IEXDevs/HACKTX26.git relay
cd relay
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Use three different generated values for `POSTGRES_PASSWORD`, `SESSION_SECRET`, and `CONNECTOR_SECRET`. Set a strong `DASHBOARD_PASSWORD`. Set `RELAY_DOMAIN`, `MUSE_API_KEY`, `MUSE_MODEL`, and `SERPAPI_API_KEY`. Use `RELAY_MODE=live` for real inference and search. For a fixture deployment, set `RELAY_MODE=fixture`; credentials can remain blank.

Compose constructs the database URL internally. Its PostgreSQL password must use URL-safe characters; a hex password satisfies this requirement. `DATABASE_URL` and `APP_URL` from the local `.env` do not override the explicit production Compose values.

The worker receives the Meta key. The connector receives the SerpAPI key and the private artifact volume. The web receives only configuration flags for those providers. No GCS service account, Gemini key, Snowflake token, wallet, or external database service is required.

## Start

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 migrate worker connectors web
```

Avoid printing `docker compose config` without `--quiet`; it expands secrets. The migration service applies the existing schema and seeds the Meta-only templates. The other services wait for database and connector readiness. Caddy obtains TLS and proxies the event stream without response buffering.

## Verify

- Sign in at the HTTPS domain. Start **Community Event Operations · Meta**.
- Confirm extracted requirements. Inspect a real SerpAPI search ID, URLs, and the Meta model steps.
- Keep unknown prices, capacity, and availability unresolved. Approve the exact brief and page content separately.
- Check the artifact's `local://` reference through Relay's authenticated artifact API. Files are private to the connector volume.
- Restart the worker during an approval pause. Confirm the action ID and hash remain unchanged. Approve and verify only one artifact is stored.
- Start the same published version with a scoped platform API key. Reconnect its event stream and refresh its dashboard view.
- Verify that Usage shows the actual PostgreSQL execution chart. Test credits remain a local allowance with no payment flow.

## Limits

One VM is a single point of failure. Keep database backups and disk snapshots outside the VM. Scale or move PostgreSQL later if needed. Do not treat a successful local build as deployment proof.

The prototype uses a shared workspace password. Add user identity, roles, rate limits, password throttling, key expiry, retention controls, and abuse limits before broad public access. Participant interest is demonstration-only; its cookie is not an identity system.
