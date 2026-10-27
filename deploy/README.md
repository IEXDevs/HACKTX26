# Google Cloud deployment

The web app runs on the existing `astronom` Cloud Run service in `us-central1`.
Supabase Postgres stores the core data in the private `astronom` schema. Supabase
Auth and the existing public telemetry tables keep their current roles.

A dedicated `e2-medium` Compute Engine VM runs Docker and serves the agent files
over private NFS. Its separate 30 GB persistent disk survives VM replacement.
Both machines use `/srv/astronom/workspaces`, so Docker bind mounts refer to the
same files that the web app reads. The VM has no Google service account.

## Access to approve before setup

- A new `astronom_app` Postgres login owns only the private app schema. It has no
  superuser, database creation, role creation, replication, or explicit access to
  the public, auth, or storage schemas. Its generated password stays in the local
  ignored `deploy/.secrets/` folder until it is stored in Secret Manager.
- GitHub can impersonate `astronom-deploy` only from this repository's main
  workflow on `refs/heads/main`. No permanent Google service-account key is used.
- The deploy identity can update this Cloud Run service, use its runtime service
  account and subnet, publish images to this Artifact Registry repository, inspect
  secret version metadata, and append versions to the Supabase service-role
  secret. It can use IAP SSH with administrative access to the dedicated worker
  to load the sandbox image. It has no direct Secret Manager read-value permission.
- The Cloud Run runtime identity can read only the named runtime secrets. Docker
  uses mutual TLS. The Docker and NFS ports accept traffic only from the private
  web subnet; SSH accepts only IAP traffic. Docker client certificates grant root
  control over this dedicated worker and must stay in Secret Manager.

The worker VM, its disks, and one continuously allocated Cloud Run instance incur
ongoing Google Cloud charges. Continuous CPU is needed because runs continue
after their HTTP request ends. The first release caps the web service at one
instance. The worker is a single point of failure; disk snapshots and worker
updates are operating tasks. TLS certificates need rotation before their
one-year expiry.

Worker SSH uses an OS Login key with a ten-minute lifetime. The helper registers
it only in `us-central1` and uses IAP with host-key checks. This avoids a regional
key-registration error from the default global OS Login request.

## Preserved data

The core schema and restricted runtime login have been applied to Supabase after
explicit operator approval. The local SQLite data has been imported into the
remote target in one transaction with checks for every table count.

The local SQLite file has been imported into local PGlite with row-count checks.
The original SQLite file is retained. Only this local copy needs to be preserved
at cutover, as confirmed by the operator.

## Setup and first cutover

1. Approve the access above. Create the restricted database login using its
   generated credential, then apply `supabase/runtime-role.sql`. Never put its
   password into migration history or a commit.
2. Import the local SQLite file into the empty Supabase target. The importer
   opens the source read-only, inserts all tables in one transaction, refuses a
   nonempty target, and verifies every table count before commit. Imported vault
   credentials require preserving their encryption key or re-encrypting them.
   The current local source has no vault credentials.
3. With an authenticated administrator's gcloud CLI, run
   `bash scripts/gcp/setup.sh` from this checkout. It creates the private network,
   worker and persistent disk, runtime identity, restricted GitHub federation,
   and named secrets. Runtime values come only from the allowlisted files in
   `deploy/.secrets/`. The local Meta/Muse key is excluded.
4. Copy the local `.runtime/workspaces` directory to the worker at
   `/srv/astronom/workspaces`. Preserve the original local copy. Use IAP SSH/SCP,
   then give the copied files UID/GID 1000. Do not include local environment files
   or a Meta key in that copy.
5. Disable the existing Astronom Cloud Build auto-deploy trigger
   `aa505d2e-3adc-4930-9566-75c914afdd89` after checking its source settings. This
   prevents it from bypassing CI or racing the new job. The duplicate `hacktx26`
   trigger `1df21322-1c5c-4f08-9b14-651aa5730641` is also disabled with operator
   approval. Its service is pinned to the prior revision `hacktx26-00029-gk5`.
6. Merge the prepared code only after the runtime dependencies are ready. Set
   the **repository** Actions variable `GCP_DEPLOY_ENABLED` to `true`. Keep
   `SUPABASE_SERVICE_ROLE_KEY` in the GitHub `main` environment. Run the main
   workflow manually for the first release.

Every later main push runs lint, types, tests, a production build, and a standalone
package check. On success, the deploy job builds immutable app and sandbox images,
loads the sandbox image over IAP with a short-lived registry token, and deploys a
tagged candidate with no production traffic. It checks `/api/health`, then moves
traffic. A failed candidate leaves the prior revision serving traffic. The prior
revision remains available for rollback; database migrations must stay compatible
with the previous release.

## Runtime secrets

| Secret Manager name | Container setting |
| --- | --- |
| `astronom-database-url` | `DATABASE_URL` |
| `astronom-credential-encryption-key` | `CREDENTIAL_ENCRYPTION_KEY` |
| `astronom-supabase-url` | `NEXT_PUBLIC_SUPABASE_URL` |
| `astronom-supabase-anon-key` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `astronom-supabase-service-role-key` | `SUPABASE_SERVICE_ROLE_KEY` |
| `astronom-docker-ca` | `/run/docker-ca/ca.pem` |
| `astronom-docker-cert` | `/run/docker-cert/cert.pem` |
| `astronom-docker-key` | `/run/docker-key/key.pem` |

Each secret uses its own mount directory. The image provides fixed symlinks
under `/run/docker`, which is the Docker client's certificate directory.

The deploy script resolves and pins enabled secret versions for each revision.
Optional Gemini, Composio, SerpAPI, and Anthropic keys can use the matching
`astronom-<provider>-api-key` secrets. Grant the runtime identity access to each
optional secret before enabling it. The existing local Meta key stays local.

Users can add one Muse key per account in Connectors. The app encrypts it with
`CREDENTIAL_ENCRYPTION_KEY` in the private database. List responses contain only
metadata; saved values have no reveal or export endpoint. The blurred UI uses a
fixed placeholder. Delete a key before adding its replacement. Production model
calls use the initiating account's saved key, never a shared environment key.
Without an account key, runs keep the scripted fallback. Documents use the same
account ownership for listing, deletion, and agent retrieval. Document bodies use
the same encryption; only their names and metadata are listed. Existing documents
identified by an author's email move to that verified account when it signs in.

For local imports:

```sh
pnpm db:import-sqlite                         # inspect; source stays unchanged
pnpm db:import-sqlite -- --apply               # import into an empty DATABASE_URL
pnpm db:migrate                               # apply pending Postgres migrations
```

Development and tests use embedded Postgres (`pglite://`). Cloud Run rejects a
local database URL. Legacy SQLite migration files stay in the repository as
history; new schema changes use `apps/web/src/lib/db/pg-migrations`.

Supabase database connections verify the server hostname and certificate chain.
The package includes the public CA certificate linked from this project's
Database Settings. Its source is
`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`.
Update that file when Supabase rotates its CA. Other remote Postgres hosts use
the platform trust store.
