#!/usr/bin/env bash
# Crew chat MVP staging soak (stream token, devices, notification prefs).
# Requires staging API deployed with migration 0014+ (crypto tables dropped).
set -euo pipefail

log() { printf "\n[%s] %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { printf "\n[FAIL] %s\n" "$*" >&2; exit 1; }

required_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Missing: $1"; }
required_env() { [[ -n "${!1:-}" ]] || fail "Missing env: $1"; }

required_cmd curl
required_cmd jq

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
  local code
  local IFS='|'
  for code in $want; do
    if [[ "$actual" == "$code" ]]; then
      return 0
    fi
  done
  fail "$label HTTP $actual — $(cat "$body_file" 2>/dev/null || true)"
}

log "Push device registration"
push_file="$(api_request POST /chat/devices '{"deviceId":"soak-chat-1","platform":"ios","token":"apns-soak-chat"}')"
code="$(cat "$tmp_dir/last_code.txt")"
if [[ "$code" == "404" ]]; then
  fail "POST /chat/devices HTTP 404 — deploy feature branch first. Body: $(cat "$push_file")"
fi
expect_code "201" "$code" "POST /chat/devices" "$push_file"
log "Push device registered"

log "List race rooms"
rooms_file="$(api_request GET /race-rooms/mine)"
expect_code "200" "$(cat "$tmp_dir/last_code.txt")" "GET /race-rooms/mine" "$rooms_file"
room_id="$(jq -r '.rooms[0].id // empty' "$rooms_file")"
[[ -n "$room_id" ]] || fail "No race rooms for test user"
log "Using room $room_id"

log "Notification prefs round-trip"
prefs_get_file="$(api_request GET "/chat/rooms/${room_id}/notification-prefs")"
expect_code "200" "$(cat "$tmp_dir/last_code.txt")" "GET notification-prefs" "$prefs_get_file"
prefs_post_file="$(api_request POST "/chat/rooms/${room_id}/notification-prefs" '{"preference":"mentions"}')"
expect_code "200" "$(cat "$tmp_dir/last_code.txt")" "POST notification-prefs" "$prefs_post_file"
prefs_after_file="$(api_request GET "/chat/rooms/${room_id}/notification-prefs")"
expect_code "200" "$(cat "$tmp_dir/last_code.txt")" "GET notification-prefs after" "$prefs_after_file"
pref="$(jq -r '.preference // empty' "$prefs_after_file")"
[[ "$pref" == "mentions" ]] || fail "Expected preference=mentions, got: $pref"
log "Notification prefs OK"

log "Crypto routes must be gone"
ident_file="$(api_request POST /chat/identity '{"publicKey":"should-404"}')"
ident_code="$(cat "$tmp_dir/last_code.txt")"
[[ "$ident_code" == "404" ]] || fail "POST /chat/identity expected 404, got $ident_code ($(cat "$ident_file"))"
env_file="$(api_request GET "/chat/rooms/${room_id}/key-envelopes")"
env_code="$(cat "$tmp_dir/last_code.txt")"
[[ "$env_code" == "404" ]] || fail "GET key-envelopes expected 404, got $env_code ($(cat "$env_file"))"
log "Crypto routes absent"

log "Stream token (optional)"
stream_file="$(api_request POST /chat/stream-token "$(jq -n --arg roomId "$room_id" '{roomId: $roomId}')")"
stream_code="$(cat "$tmp_dir/last_code.txt")"
if [[ "$stream_code" == "200" ]]; then
  log "Stream token minted"
elif [[ "$stream_code" == "503" ]]; then
  log "Stream not configured on staging (503) — OK for MVP soak"
else
  fail "POST /chat/stream-token HTTP $stream_code"
fi

log "Staging chat soak PASSED"
