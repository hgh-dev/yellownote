#!/usr/bin/env bash
set -euo pipefail

# Run from this repository in Google Cloud Shell after signing in to the intended project.
yn_project_id="yellownote"
yn_region="asia-northeast3"
yn_service="yellownote-sync"
yn_identity="yellownote-sync@${yn_project_id}.iam.gserviceaccount.com"
yn_client_id="829935199700-3f04te123lbub99p7i2lb1q1dthbm345.apps.googleusercontent.com"
yn_frontend="https://hgh-dev.github.io/yellownote/"

gcloud config set project "$yn_project_id"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com drive.googleapis.com

if ! gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  gcloud firestore databases create --database='(default)' --location="$yn_region" --type=firestore-native
fi
if ! gcloud iam service-accounts describe "$yn_identity" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$yn_service" --display-name='Yellow Note sync server'
fi
gcloud projects add-iam-policy-binding "$yn_project_id" --member="serviceAccount:$yn_identity" --role=roles/datastore.user --quiet >/dev/null

for yn_secret in yellownote-oauth-client-secret yellownote-session-key; do
  if ! gcloud secrets describe "$yn_secret" >/dev/null 2>&1; then
    gcloud secrets create "$yn_secret" --replication-policy=automatic
  fi
  gcloud secrets add-iam-policy-binding "$yn_secret" --member="serviceAccount:$yn_identity" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
done

if [[ -z "$(gcloud secrets versions list yellownote-oauth-client-secret --filter='state=ENABLED' --format='value(name)')" ]]; then
  read -r -s -p 'OAuth 웹 클라이언트 보안 비밀번호를 입력하세요 (화면에 표시되지 않음): ' yn_oauth_secret
  printf '\n'
  printf '%s' "$yn_oauth_secret" | gcloud secrets versions add yellownote-oauth-client-secret --data-file=-
  unset yn_oauth_secret
fi
if [[ -z "$(gcloud secrets versions list yellownote-session-key --filter='state=ENABLED' --format='value(name)')" ]]; then
  openssl rand -base64 32 | gcloud secrets versions add yellownote-session-key --data-file=-
fi

yn_existing_url="$(gcloud run services describe "$yn_service" --region "$yn_region" --format='value(status.url)' 2>/dev/null || true)"
yn_initial_url="${yn_existing_url:-https://example.invalid}"
gcloud run deploy "$yn_service" \
  --source . \
  --region "$yn_region" \
  --service-account "$yn_identity" \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$yn_project_id,GOOGLE_CLIENT_ID=$yn_client_id,FRONTEND_URL=$yn_frontend,PUBLIC_BASE_URL=$yn_initial_url" \
  --set-secrets 'GOOGLE_CLIENT_SECRET=yellownote-oauth-client-secret:latest,SESSION_ENCRYPTION_KEY=yellownote-session-key:latest'

yn_url="$(gcloud run services describe "$yn_service" --region "$yn_region" --format='value(status.url)')"
if [[ "$yn_initial_url" != "$yn_url" ]]; then
  gcloud run services update "$yn_service" --region "$yn_region" --update-env-vars "PUBLIC_BASE_URL=$yn_url"
fi
cat <<EOM

Cloud Run 주소: $yn_url

다음 단계:
1. Google 인증 플랫폼의 기존 OAuth 웹 클라이언트에 승인된 리디렉션 URI를 추가하세요:
   $yn_url/api/auth/callback
2. GitHub 저장소 Actions Variables에 SERVER_SYNC=true, SYNC_API_URL=$yn_url 을 추가하세요.
3. GitHub Pages 워크플로를 다시 실행한 뒤 기존 앱 주소에서 로그인하세요.
EOM
