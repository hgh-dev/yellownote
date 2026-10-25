#!/usr/bin/env bash
set -euo pipefail

# Run locally with Node.js installed. Cloudflare's free Workers/D1 plan is sufficient.
if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js가 필요합니다: https://nodejs.org/\n' >&2
  exit 1
fi
if [[ ! -f wrangler.jsonc ]]; then
  cp cloudflare/wrangler.template.jsonc wrangler.jsonc
fi

printf '브라우저에서 Cloudflare 로그인을 완료하세요.\n'
npx --yes wrangler login

if ! grep -q '"database_id"' wrangler.jsonc; then
  npx --yes wrangler d1 create yellownote-sessions --binding DB --update-config
fi
npx --yes wrangler d1 execute yellownote-sessions --remote --file cloudflare/schema.sql --yes

yn_deploy_log="$(mktemp)"
trap 'rm -f "$yn_deploy_log"' EXIT
npx --yes wrangler deploy 2>&1 | tee "$yn_deploy_log"

yn_secrets_json="$(npx --yes wrangler secret list --format json)"
if ! printf '%s' "$yn_secrets_json" | node -e 'let data="";process.stdin.on("data",x=>data+=x);process.stdin.on("end",()=>process.exit(JSON.parse(data).some(x=>x.name==="GOOGLE_CLIENT_SECRET")?0:1))'; then
  read -r -s -p 'Google OAuth 웹 클라이언트 보안 비밀번호를 입력하세요 (화면에 표시되지 않음): ' yn_client_secret
  printf '\n'
  printf '%s' "$yn_client_secret" | npx --yes wrangler secret put GOOGLE_CLIENT_SECRET
  unset yn_client_secret
fi
if ! printf '%s' "$yn_secrets_json" | node -e 'let data="";process.stdin.on("data",x=>data+=x);process.stdin.on("end",()=>process.exit(JSON.parse(data).some(x=>x.name==="SESSION_ENCRYPTION_KEY")?0:1))'; then
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))' | npx --yes wrangler secret put SESSION_ENCRYPTION_KEY
fi

yn_url="$(sed -n 's/.*\(https:\/\/[A-Za-z0-9.-]*\.workers\.dev\).*/\1/p' "$yn_deploy_log" | tail -1)"
cat <<EOM

Cloudflare Worker 주소: $yn_url

다음 단계:
1. Google 인증 플랫폼의 기존 OAuth 웹 클라이언트에 승인된 리디렉션 URI를 추가하세요:
   $yn_url/api/auth/callback
2. 위 Worker 주소를 저에게 보내주세요. 제가 기존 GitHub Pages 주소에 연결하겠습니다.
EOM
