#!/usr/bin/env bash
# Practical E2E chat staging soak (identity, backup, user-scoped envelopes).
# Requires staging API deployed with migration 0013+.
set -euo pipefail

log() { printf "\n[%s] %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { printf "\n[FAIL] %s\n" "$*" >&2; exit 1; }

required_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Missing: $1"; }
required_env() { [[ -n "${!1:-}" ]] || fail "Missing env: $1"; }

required_cmd curl
required_cmd jq
required_cmd python3

required_env API_BASE_URL
required_env AUTH0_ISSUER
required_env AUTH0_AUDIENCE
required_env AUTH0_CLIENT_ID
required_env AUTH0_USER_EMAIL
required_env AUTH0_USER_PASSWORD

AUTH0_CONNECTION="${AUTH0_CONNECTION:-Username-Password-Authentication}"
auth0_token_endpoint="${AUTH0_ISSUER%/}/oauth/token"
api_base="${API_BASE_URL%/}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

log "Minting Auth0 token"
token_response_file="$tmp_dir/token.json"
token_status="$(curl -sS -o "$token_response_file" -w "%{http_code}" \
  -X POST "$auth0_token_endpoint" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg grant_type "http://auth0.com/oauth/grant-type/password-realm" \
    --arg username "$AUTH0_USER_EMAIL" \
    --arg password "$AUTH0_USER_PASSWORD" \
    --arg audience "$AUTH0_AUDIENCE" \
    --arg client_id "$AUTH0_CLIENT_ID" \
    --arg realm "$AUTH0_CONNECTION" \
    '{grant_type: $grant_type, username: $username, password: $password, audience: $audience, client_id: $client_id, realm: $realm}')")"
[[ "$token_status" == "200" ]] || fail "Auth0 token failed (HTTP $token_status): $(jq -c . "$token_response_file")"
ACCESS_TOKEN="$(jq -r '.access_token // empty' "$token_response_file")"
[[ -n "$ACCESS_TOKEN" ]] || fail "No access_token"

api_request() {
  local method="$1" path="$2" body="${3:-}"
  local out_file="$tmp_dir/resp.json"
  local code
  if [[ -n "$body" ]]; then
    code="$(curl -sS -o "$out_file" -w "%{http_code}" \
      -X "$method" "${api_base}${path}" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Accept: application/json" \
      -H "Content-Type: application/json" \
      -d "$body")"
  else
    code="$(curl -sS -o "$out_file" -w "%{http_code}" \
      -X "$method" "${api_base}${path}" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Accept: application/json")"
  fi
  echo "$code" > "$tmp_dir/last_code.txt"
  echo "$out_file"
}

expect_code() {
  local want="$1" actual="$2" label="$3" body_file="$4"
  if [[ "$actual" != "$want" && "$actual" != "${want%%|*}" ]]; then
    if [[ "$want" == *"|* ]]; then
      local alt="${want#*|}"
      [[ "$actual" == "$alt" ]] && return 0
    fi
    fail "$label HTTP $actual — $(cat "$body_file" 2>/dev/null || true)"
  fi
}

log "Probe POST /chat/identity (must exist on deployed API)"
ident_file="$(api_request POST /chat/identity '{"publicKey":"c29hay1pZGVudGl0eS1wa2I="}')"
code="$(cat "$tmp_dir/last_code.txt")"
if [[ "$code" == "404" ]]; then
  fail "POST /chat/identity HTTP 404 — deploy feature branch + db:migrate 0013 first. Body: $(cat "$ident_file")"
fi
expect_code "201" "$code" "POST /chat/identity" "$ident_file"
log "Identity registered"

log "Backup round-trip"
backup_post_file="$(api_request POST /chat/identity/backup '{"ciphertext":"c29hay1jdA==","nonce":"c29hay1u","version":1}')"
expect_code "201" "$(cat "$tmp_dir/last_code.txt")" "POST /chat/identity/backup" "$backup_post_file"
backup_get_file="$(api_request GET /chat/identity/backup)"
expect_code "200" "$(cat "$tmp_dir/last_code.txt")" "GET /chat/identity/backup" "$backup_get_file"
log "Backup OK"

log "Push device registration"
push_file="$(api_request POST /chat/devices '{"deviceId":"soak-chat-1","platform":"ios","token":"apns-soak-chat"}')"
expect_code "201" "$(cat "$tmp_dir/last_code.txt")" "POST /chat/devices" "$push_file"

log "List race rooms"
rooms_file="$(api_request GET /race-rooms/mine)"
expect_code "200" "$(cat "$tmp_dir/last_code.txt")" "GET /race-rooms/mine" "$rooms_file"
room_id="$(jq -r '.rooms[0].id // empty' "$rooms_file")"
[[ -n "$room_id" ]] || fail "No race rooms for test user"
log "Using room $room_id"

log "Key envelope upload/list"
read -r sub _ <<< "$(echo "$ACCESS_TOKEN" | cut -d. -f2 | python3 -c "import sys,base64,json; p=sys.stdin.read().strip(); p+='='*((4-len(p)%4)%4); print(json.loads(base64.urlsafe_b64decode(p))['sub'])")"
envelope_body="$(jq -n --arg uid "$sub" '{
  envelopes: [{
    recipientUserId: $uid,
    senderEphemeralPublicKey: "c29hay1lcGg=",
    nonce: "c29hay1u",
    ciphertext: "c29hay1jdA==",
    keyVersion: 1
  }]
}')"
env_post_file="$(api_request POST "/chat/rooms/${room_id}/key-envelopes" "$envelope_body")"
expect_code "201" "$(cat "$tmp_dir/last_code.txt")" "POST key-envelopes" "$env_post_file"
env_get_file="$(api_request GET "/chat/rooms/${room_id}/key-envelopes")"
expect_code "200" "$(cat "$tmp_dir/last_code.txt")" "GET key-envelopes" "$env_get_file"
count="$(jq -r '.envelopes | length' "$env_get_file")"
[[ "$count" -ge 1 ]] || fail "Expected envelopes for caller"
log "Envelopes OK (count=$count)"

log "Stream token (optional)"
stream_file="$(api_request POST /chat/stream-token "$(jq -n --arg roomId "$room_id" '{roomId: $roomId}')")"
stream_code="$(cat "$tmp_dir/last_code.txt")"
if [[ "$stream_code" == "200" ]]; then
  log "Stream token minted"
elif [[ "$stream_code" == "503" ]]; then
  log "Stream not configured on staging (503) — OK for crypto soak"
else
  fail "POST /chat/stream-token HTTP $stream_code"
fi

log "Staging chat soak PASSED"
