#!/usr/bin/env bash
set -euo pipefail
umask 077
source "$(dirname "$0")/../../deploy/gcp.env"
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT

if gcloud secrets versions list astronom-docker-key --filter='state=ENABLED' --format='value(name)' --limit=1 | grep -q .; then
  echo 'Existing worker TLS identity found. No credentials were rotated.'
  exit 0
fi
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$temporary/ca-key.pem" 2>/dev/null
openssl req -new -x509 -days 365 -sha256 -key "$temporary/ca-key.pem" -subj /CN=astronom-worker-ca -out "$temporary/ca.pem"
for identity in server client; do
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$temporary/$identity-key.pem" 2>/dev/null
  openssl req -new -key "$temporary/$identity-key.pem" -subj "/CN=astronom-$identity" -out "$temporary/$identity.csr"
done
printf 'subjectAltName=IP:%s\nextendedKeyUsage=serverAuth\n' "$GCP_WORKER_IP" > "$temporary/server.ext"
printf 'extendedKeyUsage=clientAuth\n' > "$temporary/client.ext"
for identity in server client; do
  openssl x509 -req -days 365 -sha256 -in "$temporary/$identity.csr" -CA "$temporary/ca.pem" \
    -CAkey "$temporary/ca-key.pem" -CAcreateserial -extfile "$temporary/$identity.ext" -out "$temporary/$identity-cert.pem" 2>/dev/null
done

# Wait for the startup script to mount the durable disk and install packages.
gcloud compute ssh "$GCP_WORKER" --zone="$GCP_ZONE" --tunnel-through-iap --quiet --ssh-key-expire-after=10m \
  --command='for attempt in $(seq 1 120); do test -f /etc/docker/daemon.json && mountpoint -q /srv/astronom && exit 0; sleep 5; done; exit 1'
gcloud compute ssh "$GCP_WORKER" --zone="$GCP_ZONE" --tunnel-through-iap --quiet --ssh-key-expire-after=10m \
  --command='install -d -m 700 /tmp/astronom-tls-setup'
gcloud compute scp --zone="$GCP_ZONE" --tunnel-through-iap --quiet \
  "$temporary/ca.pem" "$temporary/ca-key.pem" "$temporary/server-cert.pem" "$temporary/server-key.pem" "$GCP_WORKER:/tmp/astronom-tls-setup/"
gcloud compute ssh "$GCP_WORKER" --zone="$GCP_ZONE" --tunnel-through-iap --quiet --ssh-key-expire-after=10m \
  --command='sudo install -m 600 /tmp/astronom-tls-setup/*.pem /srv/astronom/tls/ && rm -f /tmp/astronom-tls-setup/*.pem && rmdir /tmp/astronom-tls-setup && sudo systemctl restart docker && sudo docker info --format="{{.ServerVersion}}"'

for pair in ca:ca.pem cert:client-cert.pem key:client-key.pem; do
  gcloud secrets versions add "astronom-docker-${pair%%:*}" --data-file="$temporary/${pair#*:}" >/dev/null
done
echo 'Worker TLS is ready. Certificates expire in one year; schedule rotation before expiry.'
