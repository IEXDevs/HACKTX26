#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../../deploy/gcp.env"
: "${APP_IMAGE:?Set APP_IMAGE to the immutable app image tag}"
: "${SANDBOX_IMAGE:?Set SANDBOX_IMAGE to the matching sandbox image tag}"

runtime_account="$GCP_RUNTIME_ACCOUNT@$GCP_PROJECT_ID.iam.gserviceaccount.com"
secret_refs=()
secret_version() {
  local version
  version=$(gcloud secrets versions list "$1" --project "$GCP_PROJECT_ID" \
    --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)')
  test -n "$version" || { echo "Missing enabled secret version: $1" >&2; return 1; }
  printf '%s' "${version##*/}"
}
add_secret() {
  secret_refs+=("$1=$2:$(secret_version "$2")")
}
add_secret DATABASE_URL astronom-database-url
add_secret CREDENTIAL_ENCRYPTION_KEY astronom-credential-encryption-key
add_secret NEXT_PUBLIC_SUPABASE_URL astronom-supabase-url
add_secret NEXT_PUBLIC_SUPABASE_ANON_KEY astronom-supabase-anon-key
add_secret SUPABASE_SERVICE_ROLE_KEY astronom-supabase-service-role-key
add_secret /run/docker/ca.pem astronom-docker-ca
add_secret /run/docker/cert.pem astronom-docker-cert
add_secret /run/docker/key.pem astronom-docker-key

# These keys are optional. The local Meta key is deliberately excluded.
for pair in GEMINI_API_KEY:gemini COMPOSIO_API_KEY:composio SERPAPI_API_KEY:serpapi ANTHROPIC_API_KEY:anthropic; do
  name="astronom-${pair#*:}-api-key"
  if gcloud secrets describe "$name" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    add_secret "${pair%%:*}" "$name"
  fi
done

# GitHub runners cannot reach the private worker. Run the pull on the worker
# via IAP; the worker uses a short-lived registry token passed over SSH stdin.
gcloud auth print-access-token | gcloud compute ssh "$GCP_WORKER" --project="$GCP_PROJECT_ID" \
  --zone="$GCP_ZONE" --tunnel-through-iap --quiet --ssh-key-expire-after=10m \
  --command="set -eu; config=\$(mktemp -d); trap 'sudo rm -rf -- \"\$config\"' EXIT; sudo docker --config=\"\$config\" login -u oauth2accesstoken --password-stdin https://$GCP_REGION-docker.pkg.dev >/dev/null; sudo docker --config=\"\$config\" pull '$SANDBOX_IMAGE'"

joined=$(IFS=,; printf '%s' "${secret_refs[*]}")
gcloud run deploy "$GCP_SERVICE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" \
  --image="$APP_IMAGE" --service-account="$runtime_account" \
  --execution-environment=gen2 --cpu=1 --memory=1Gi --min=1 --max=1 \
  --no-cpu-throttling --timeout=3600 --concurrency=40 \
  --network="$GCP_NETWORK" --subnet="$GCP_RUN_SUBNET" --vpc-egress=private-ranges-only \
  --add-volume="name=workspaces,type=nfs,location=$GCP_WORKER_IP:$GCP_WORKSPACE_PATH" \
  --add-volume-mount="volume=workspaces,mount-path=$GCP_WORKSPACE_PATH" \
  --update-env-vars="SANDBOX_ROOT=$GCP_WORKSPACE_PATH,SANDBOX_IMAGE=$SANDBOX_IMAGE,DOCKER_HOST=tcp://$GCP_WORKER_IP:2376,DOCKER_TLS_VERIFY=1,DOCKER_CERT_PATH=/run/docker,MODEL_GATEWAY=scripted" \
  --remove-env-vars=OPENAI_API_KEY,OPENAI_BASE_URL --remove-secrets=OPENAI_API_KEY \
  --update-secrets="$joined" --tag=candidate --no-traffic --quiet

candidate=$(gcloud run services describe "$GCP_SERVICE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" \
  --format=json | python3 -c 'import json,sys; print(next(t["url"] for t in json.load(sys.stdin)["status"]["traffic"] if t.get("tag")=="candidate"))')
curl --fail --retry 8 --retry-delay 5 --retry-all-errors "$candidate/api/health"
gcloud run services update-traffic "$GCP_SERVICE" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --to-tags=candidate=100 --quiet
