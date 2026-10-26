#!/usr/bin/env bash
# Source after gcp.env. gcloud's global key import fails on this project; scope
# the import to the worker region, then let gcloud manage the IAP/host-key flags.
prepare_worker_access() {
  worker_ssh_key="${ASTRONOM_SSH_KEY_FILE:-$HOME/.ssh/astronom-worker}"
  mkdir -p "$(dirname "$worker_ssh_key")"
  if ! test -f "$worker_ssh_key"; then
    ssh-keygen -q -t ed25519 -N '' -C astronom-worker -f "$worker_ssh_key"
  fi
  local directory
  directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  worker_user=$(python3 "$directory/worker-login.py" "$worker_ssh_key.pub" "$GCP_PROJECT_ID" "$GCP_REGION")
  worker_access=(--project="$GCP_PROJECT_ID" --zone="$GCP_ZONE" --tunnel-through-iap --plain --quiet)
}

worker_ssh() {
  gcloud compute ssh "$worker_user@$GCP_WORKER" "${worker_access[@]}" --command="$1" -- \
    -i "$worker_ssh_key" -oBatchMode=yes -oStrictHostKeyChecking=accept-new
}

worker_scp() {
  local destination="$1"
  shift
  gcloud compute scp "${worker_access[@]}" --scp-flag=-i --scp-flag="$worker_ssh_key" \
    --scp-flag=-oBatchMode=yes --scp-flag=-oStrictHostKeyChecking=accept-new \
    "$@" "$worker_user@$GCP_WORKER:$destination"
}
