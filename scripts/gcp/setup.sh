#!/usr/bin/env bash
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/../.." && pwd)
source "$root/deploy/gcp.env"
gcloud config set project "$GCP_PROJECT_ID"
gcloud services enable run.googleapis.com compute.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  iap.googleapis.com oslogin.googleapis.com

if ! gcloud artifacts repositories describe "$GCP_REPOSITORY" --location="$GCP_REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$GCP_REPOSITORY" --location="$GCP_REGION" --repository-format=docker
fi
if ! gcloud compute networks describe "$GCP_NETWORK" >/dev/null 2>&1; then
  gcloud compute networks create "$GCP_NETWORK" --subnet-mode=custom
fi
for pair in "$GCP_RUN_SUBNET:$GCP_RUN_RANGE" "$GCP_WORKER_SUBNET:$GCP_WORKER_RANGE"; do
  if ! gcloud compute networks subnets describe "${pair%%:*}" --region="$GCP_REGION" >/dev/null 2>&1; then
    gcloud compute networks subnets create "${pair%%:*}" --network="$GCP_NETWORK" \
      --region="$GCP_REGION" --range="${pair#*:}" --enable-private-ip-google-access
  fi
done
if ! gcloud compute firewall-rules describe astronom-worker-private >/dev/null 2>&1; then
  gcloud compute firewall-rules create astronom-worker-private --network="$GCP_NETWORK" \
    --source-ranges="$GCP_RUN_RANGE" --target-tags=astronom-worker \
    --allow=tcp:2376,tcp:111,udp:111,tcp:2049,udp:2049,tcp:20048,udp:20048
fi
if ! gcloud compute firewall-rules describe astronom-worker-iap >/dev/null 2>&1; then
  gcloud compute firewall-rules create astronom-worker-iap --network="$GCP_NETWORK" \
    --source-ranges=35.235.240.0/20 --target-tags=astronom-worker --allow=tcp:22
fi
if ! gcloud compute disks describe "$GCP_DATA_DISK" --zone="$GCP_ZONE" >/dev/null 2>&1; then
  gcloud compute disks create "$GCP_DATA_DISK" --zone="$GCP_ZONE" --size=30GB --type=pd-balanced
fi
if ! gcloud compute instances describe "$GCP_WORKER" --zone="$GCP_ZONE" >/dev/null 2>&1; then
  gcloud compute instances create "$GCP_WORKER" --zone="$GCP_ZONE" --machine-type=e2-medium \
    --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
    --boot-disk-size=20GB --boot-disk-type=pd-balanced \
    --disk="name=$GCP_DATA_DISK,device-name=$GCP_DATA_DISK,auto-delete=no" \
    --subnet="$GCP_WORKER_SUBNET" --private-network-ip="$GCP_WORKER_IP" \
    --tags=astronom-worker --no-service-account --no-scopes \
    --metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE \
    --metadata-from-file="startup-script=$root/scripts/gcp/worker-startup.sh"
fi

deploy="$GCP_DEPLOY_ACCOUNT@$GCP_PROJECT_ID.iam.gserviceaccount.com"
runtime="$GCP_RUNTIME_ACCOUNT@$GCP_PROJECT_ID.iam.gserviceaccount.com"
for account in "$GCP_DEPLOY_ACCOUNT" "$GCP_RUNTIME_ACCOUNT"; do
  if ! gcloud iam service-accounts describe "$account@$GCP_PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$account"
  fi
done
gcloud artifacts repositories add-iam-policy-binding "$GCP_REPOSITORY" --location="$GCP_REGION" \
  --member="serviceAccount:$deploy" --role=roles/artifactregistry.writer >/dev/null
gcloud run services add-iam-policy-binding "$GCP_SERVICE" --region="$GCP_REGION" \
  --member="serviceAccount:$deploy" --role=roles/run.developer >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$runtime" --member="serviceAccount:$deploy" \
  --role=roles/iam.serviceAccountUser >/dev/null
gcloud compute networks subnets add-iam-policy-binding "$GCP_RUN_SUBNET" --region="$GCP_REGION" \
  --member="serviceAccount:$deploy" --role=roles/compute.networkUser >/dev/null
gcloud compute instances add-iam-policy-binding "$GCP_WORKER" --zone="$GCP_ZONE" \
  --member="serviceAccount:$deploy" --role=roles/compute.osAdminLogin >/dev/null
if ! gcloud iam roles describe astronomWorkerInspect --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam roles create astronomWorkerInspect --project="$GCP_PROJECT_ID" --title='Astronom worker lookup' \
    --permissions=compute.instances.get,compute.projects.get
fi
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member="serviceAccount:$deploy" \
  --role="projects/$GCP_PROJECT_ID/roles/astronomWorkerInspect" --condition=None >/dev/null
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member="serviceAccount:$deploy" \
  --role=roles/iap.tunnelResourceAccessor \
  --condition="expression=destination.port == 22 && destination.ip == '$GCP_WORKER_IP',title=astronom-worker-ssh" >/dev/null

if ! gcloud iam workload-identity-pools describe "$GCP_WIF_POOL" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$GCP_WIF_POOL" --location=global
fi
if ! gcloud iam workload-identity-pools providers describe "$GCP_WIF_PROVIDER" --workload-identity-pool="$GCP_WIF_POOL" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$GCP_WIF_PROVIDER" --location=global \
    --workload-identity-pool="$GCP_WIF_POOL" --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
    --attribute-condition="assertion.repository == '$GITHUB_REPOSITORY_NAME' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '$GITHUB_REPOSITORY_NAME/.github/workflows/main.yml@refs/heads/main'"
fi
gcloud iam service-accounts add-iam-policy-binding "$deploy" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$GCP_PROJECT_NUMBER/locations/global/workloadIdentityPools/$GCP_WIF_POOL/attribute.repository/$GITHUB_REPOSITORY_NAME" >/dev/null

runtime_secrets=(database-url credential-encryption-key supabase-url supabase-anon-key supabase-service-role-key docker-ca docker-cert docker-key)
for suffix in "${runtime_secrets[@]}"; do
  name="astronom-$suffix"
  if ! gcloud secrets describe "$name" >/dev/null 2>&1; then gcloud secrets create "$name" --replication-policy=automatic; fi
  gcloud secrets add-iam-policy-binding "$name" --member="serviceAccount:$runtime" --role=roles/secretmanager.secretAccessor >/dev/null
  gcloud secrets add-iam-policy-binding "$name" --member="serviceAccount:$deploy" --role=roles/secretmanager.viewer >/dev/null
  if test -f "$root/deploy/.secrets/$name"; then
    gcloud secrets versions add "$name" --data-file="$root/deploy/.secrets/$name" >/dev/null
  fi
done
gcloud secrets add-iam-policy-binding astronom-supabase-service-role-key --member="serviceAccount:$deploy" \
  --role=roles/secretmanager.secretVersionAdder >/dev/null

# The deployment job never receives a permanent Google service-account key.
bash "$root/scripts/gcp/setup-worker-tls.sh"
echo 'Infrastructure prepared. Disable the old Cloud Build auto-deploy trigger before enabling the GitHub deployment job.'
