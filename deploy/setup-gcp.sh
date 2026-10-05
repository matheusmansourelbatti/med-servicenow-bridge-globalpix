#!/usr/bin/env bash
# One-time Google Cloud setup: Pub/Sub topic for Gmail, Cloud Run service,
# push subscription, and Cloud Scheduler jobs. Run from the project root
# after filling in .env (PUBLIC_URL can stay empty; this script sets it).
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-southamerica-east1}"
SERVICE="med-bridge"
TOPIC="med-gmail"
INVOKER="med-bridge-invoker"
INVOKER_EMAIL="${INVOKER}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

echo "==> Enabling APIs"
gcloud services enable gmail.googleapis.com pubsub.googleapis.com run.googleapis.com \
  cloudscheduler.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

echo "==> Pub/Sub topic that Gmail publishes to"
gcloud pubsub topics create "$TOPIC" 2>/dev/null || true
gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

echo "==> Service account that signs push and scheduler requests"
gcloud iam service-accounts create "$INVOKER" --display-name="MED bridge invoker" 2>/dev/null || true
gcloud iam service-accounts add-iam-policy-binding "$INVOKER_EMAIL" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

echo "==> Converting .env to env.yaml for Cloud Run"
awk 'NF && $0 !~ /^#/ { i=index($0,"="); k=substr($0,1,i-1); v=substr($0,i+1); gsub(/"/,"\\\"",v); printf "%s: \"%s\"\n", k, v }' .env \
  | grep -v '^PORT:' > env.yaml
sed -i.bak "s#^GMAIL_PUBSUB_TOPIC:.*#GMAIL_PUBSUB_TOPIC: \"projects/${PROJECT_ID}/topics/${TOPIC}\"#; s#^ALLOWED_INVOKERS:.*#ALLOWED_INVOKERS: \"${INVOKER_EMAIL}\"#" env.yaml && rm -f env.yaml.bak

echo "==> Deploying Cloud Run service"
# Unauthenticated at the Cloud Run level on purpose: ServiceNow can't present Google
# credentials, so every route authenticates the caller itself (OIDC or Basic auth).
gcloud run deploy "$SERVICE" --source . --region "$REGION" \
  --allow-unauthenticated --env-vars-file env.yaml --min-instances 0 --max-instances 1
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "PUBLIC_URL=${URL}"

echo "==> Push subscription (signed with the invoker's OIDC token)"
gcloud pubsub subscriptions create "${TOPIC}-push" --topic "$TOPIC" \
  --push-endpoint="${URL}/gmail/push" \
  --push-auth-service-account="$INVOKER_EMAIL" \
  --push-auth-token-audience="$URL" \
  --ack-deadline=60 2>/dev/null || \
gcloud pubsub subscriptions update "${TOPIC}-push" \
  --push-endpoint="${URL}/gmail/push" \
  --push-auth-service-account="$INVOKER_EMAIL" \
  --push-auth-token-audience="$URL"

echo "==> Scheduler: renew the Gmail watch daily, sweep every 30 min"
for JOB in "renew-watch|0 6 * * *" "sweep|*/30 * * * *"; do
  NAME="${JOB%%|*}"; CRON="${JOB#*|}"
  gcloud scheduler jobs create http "med-${NAME}" --location "$REGION" \
    --schedule="$CRON" --time-zone="America/Sao_Paulo" \
    --uri="${URL}/tasks/${NAME}" --http-method=POST \
    --oidc-service-account-email="$INVOKER_EMAIL" --oidc-token-audience="$URL" 2>/dev/null || \
  gcloud scheduler jobs update http "med-${NAME}" --location "$REGION" \
    --schedule="$CRON" --uri="${URL}/tasks/${NAME}" \
    --oidc-service-account-email="$INVOKER_EMAIL" --oidc-token-audience="$URL"
done

echo
echo "Done. Bridge URL: ${URL}"
echo "Use it as the Connection URL of the 'MED Bridge' alias in ServiceNow."
