#!/usr/bin/env bash
set -euo pipefail

log() { printf "\n[%s] %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { printf "\n[FAIL] %s\n" "$*" >&2; exit 1; }

required_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

required_env() {
  local key="$1"
  [[ -n "${!key:-}" ]] || fail "Missing required env var: $key"
}

required_cmd curl
required_cmd jq
required_cmd python3

required_env API_BASE_URL
required_env AUTH0_ISSUER
required_env AUTH0_AUDIENCE
required_env AUTH0_AUTOMATION_CLIENT_ID
required_env AUTH0_AUTOMATION_CLIENT_SECRET
required_env AUTH0_AUTOMATION_USER_EMAIL
required_env AUTH0_AUTOMATION_USER_PASSWORD

AUTH0_AUTOMATION_CONNECTION="${AUTH0_AUTOMATION_CONNECTION:-automation-users}"

auth0_token_endpoint="${AUTH0_ISSUER%/}/oauth/token"
api_base="${API_BASE_URL%/}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

log "Minting Auth0 access token for automation user"
token_response_file="$tmp_dir/token.json"
token_status="$(curl -sS -o "$token_response_file" -w "%{http_code}" \
  -X POST "$auth0_token_endpoint" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg grant_type "http://auth0.com/oauth/grant-type/password-realm" \
    --arg username "$AUTH0_AUTOMATION_USER_EMAIL" \
    --arg password "$AUTH0_AUTOMATION_USER_PASSWORD" \
    --arg audience "$AUTH0_AUDIENCE" \
    --arg client_id "$AUTH0_AUTOMATION_CLIENT_ID" \
    --arg client_secret "$AUTH0_AUTOMATION_CLIENT_SECRET" \
    --arg realm "$AUTH0_AUTOMATION_CONNECTION" \
    '{grant_type: $grant_type, username: $username, password: $password, audience: $audience, client_id: $client_id, client_secret: $client_secret, realm: $realm}')" \
)"
[[ "$token_status" == "200" ]] || fail "Auth0 token request failed (HTTP $token_status): $(jq -c . "$token_response_file")"
ACCESS_TOKEN="$(jq -r '.access_token // empty' "$token_response_file")"
[[ -n "$ACCESS_TOKEN" ]] || fail "Auth0 token response missing access_token"
log "Token minted successfully"

api_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
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
  printf "%s\n%s" "$code" "$out_file"
}

json_assert() {
  local file="$1"
  local expr="$2"
  local message="$3"
  python3 - "$file" "$expr" "$message" <<'PY'
import json
import sys
file_path, expr, message = sys.argv[1], sys.argv[2], sys.argv[3]
with open(file_path, "r", encoding="utf-8") as f:
    data = json.load(f)
if not eval(expr, {"__builtins__": {}}, {"d": data, "isinstance": isinstance, "len": len, "type": type}):
    raise SystemExit(message)
PY
}

log "Step A: create room"
create_payload="$(jq -n '{teamId:"team-1", athleteId:"athlete-automation", name:"Stoppage Smoke Room", creatorRole:"team_manager"}')"
create_result="$(api_request POST "/race-rooms" "$create_payload")"
create_code="$(printf "%s" "$create_result" | sed -n '1p')"
create_file="$(printf "%s" "$create_result" | sed -n '2p')"
[[ "$create_code" == "201" ]] || fail "Create room failed (HTTP $create_code): $(jq -c . "$create_file")"
ROOM_ID="$(jq -r '.id // empty' "$create_file")"
[[ -n "$ROOM_ID" ]] || fail "Create room response missing id"
log "Created room: $ROOM_ID"

log "Step B: mark entitlement paid"
entitlement_payload='{"status":"paid"}'
entitlement_result="$(api_request POST "/race-rooms/${ROOM_ID}/entitlement" "$entitlement_payload")"
entitlement_code="$(printf "%s" "$entitlement_result" | sed -n '1p')"
entitlement_file="$(printf "%s" "$entitlement_result" | sed -n '2p')"
[[ "$entitlement_code" == "200" ]] || fail "Entitlement update failed (HTTP $entitlement_code): $(jq -c . "$entitlement_file")"

log "Step C: activate room with stoppage checkpoint config"
event_ends_at="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(hours=4)).isoformat().replace('+00:00', 'Z'))
PY
)"
activate_payload="$(jq -n --arg ends "$event_ends_at" '{
  eventEndsAt: $ends,
  plannedPaceSecondsPerKm: 600,
  course: {
    checkpoints: [
      {id:"cp-start", latitude:40.0000, longitude:-70.0000},
      {id:"cp-mid", latitude:40.0008, longitude:-70.0000, plannedStopSeconds:180, stoppageRadiusMeters:900, slowdownThresholdRatio:0.5},
      {id:"cp-finish", latitude:40.0016, longitude:-70.0000}
    ]
  }
}')"
activate_result="$(api_request POST "/race-rooms/${ROOM_ID}/activate" "$activate_payload")"
activate_code="$(printf "%s" "$activate_result" | sed -n '1p')"
activate_file="$(printf "%s" "$activate_result" | sed -n '2p')"
[[ "$activate_code" == "200" ]] || fail "Activate failed (HTTP $activate_code): $(jq -c . "$activate_file")"
ACTIVATED_AT="$(jq -r '.activatedAt // empty' "$activate_file")"
[[ -n "$ACTIVATED_AT" ]] || fail "Activate response missing activatedAt"

log "Step D: post two pings to seed projection"
recorded_1="$(python3 - "$ACTIVATED_AT" <<'PY'
from datetime import datetime, timedelta
import sys
t = datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00')) + timedelta(seconds=60)
print(t.isoformat().replace('+00:00','Z'))
PY
)"
recorded_2="$(python3 - "$ACTIVATED_AT" <<'PY'
from datetime import datetime, timedelta
import sys
t = datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00')) + timedelta(seconds=120)
print(t.isoformat().replace('+00:00','Z'))
PY
)"
ping1_payload="$(jq -n --arg t "$recorded_1" '{latitude:40.0000, longitude:-70.0000, recordedAt:$t}')"
ping2_payload="$(jq -n --arg t "$recorded_2" '{latitude:40.00081, longitude:-70.0000, recordedAt:$t}')"

for payload in "$ping1_payload" "$ping2_payload"; do
  ping_result="$(api_request POST "/race-rooms/${ROOM_ID}/pings" "$payload")"
  ping_code="$(printf "%s" "$ping_result" | sed -n '1p')"
  ping_file="$(printf "%s" "$ping_result" | sed -n '2p')"
  [[ "$ping_code" == "201" ]] || fail "Ping failed (HTTP $ping_code): $(jq -c . "$ping_file")"
done

log "Step E: fetch projection and assert stoppage shape"
projection_result="$(api_request GET "/race-rooms/${ROOM_ID}/projection")"
projection_code="$(printf "%s" "$projection_result" | sed -n '1p')"
projection_file="$(printf "%s" "$projection_result" | sed -n '2p')"
[[ "$projection_code" == "200" ]] || fail "Projection fetch failed (HTTP $projection_code): $(jq -c . "$projection_file")"
json_assert "$projection_file" "'stoppageSummary' in d and 'checkpointSplits' in d" "Projection missing stoppage fields"
CP_MID_INDEX="$(jq -r '.checkpointSplits | map(.checkpointId) | index("cp-mid")' "$projection_file")"
[[ "$CP_MID_INDEX" != "null" ]] || fail "Projection missing cp-mid split"

log "Step F: submit manual stop at cp-mid"
arrival="$(python3 - "$ACTIVATED_AT" <<'PY'
from datetime import datetime, timedelta
import sys
t = datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00')) + timedelta(seconds=70)
print(t.isoformat().replace('+00:00','Z'))
PY
)"
departure="$(python3 - "$ACTIVATED_AT" <<'PY'
from datetime import datetime, timedelta
import sys
t = datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00')) + timedelta(seconds=250)
print(t.isoformat().replace('+00:00','Z'))
PY
)"
manual_payload="$(jq -n --arg a "$arrival" --arg d "$departure" '{arrivalAt:$a, departureAt:$d, note:"automation smoke"}')"
manual_result="$(api_request POST "/race-rooms/${ROOM_ID}/checkpoints/cp-mid/manual-stop" "$manual_payload")"
manual_code="$(printf "%s" "$manual_result" | sed -n '1p')"
manual_file="$(printf "%s" "$manual_result" | sed -n '2p')"
[[ "$manual_code" == "200" ]] || fail "Manual stop failed (HTTP $manual_code): $(jq -c . "$manual_file")"
VISIT_INDEX="$(jq -r '.checkpointSplit.visits[0].visitIndex // empty' "$manual_file")"
[[ -n "$VISIT_INDEX" ]] || fail "Manual stop response missing visit index"

log "Step G: toggle resolved source to manual_crew"
toggle_payload='{"resolvedSource":"manual_crew"}'
toggle_result="$(api_request PATCH "/race-rooms/${ROOM_ID}/checkpoints/cp-mid/visits/${VISIT_INDEX}/resolved-source" "$toggle_payload")"
toggle_code="$(printf "%s" "$toggle_result" | sed -n '1p')"
toggle_file="$(printf "%s" "$toggle_result" | sed -n '2p')"
[[ "$toggle_code" == "200" ]] || fail "Resolved source toggle failed (HTTP $toggle_code): $(jq -c . "$toggle_file")"

log "Step H: negative test invalid visitIndex"
bad_index_result="$(api_request PATCH "/race-rooms/${ROOM_ID}/checkpoints/cp-mid/visits/not-a-number/resolved-source" "$toggle_payload")"
bad_index_code="$(printf "%s" "$bad_index_result" | sed -n '1p')"
bad_index_file="$(printf "%s" "$bad_index_result" | sed -n '2p')"
[[ "$bad_index_code" == "400" || "$bad_index_code" == "404" ]] || fail "Expected 400 or 404 for invalid visitIndex, got $bad_index_code: $(jq -c . "$bad_index_file")"

log "Step I: negative test impossible source toggle"
toggle_auto_payload='{"resolvedSource":"auto"}'
bad_toggle_result="$(api_request PATCH "/race-rooms/${ROOM_ID}/checkpoints/cp-mid/visits/${VISIT_INDEX}/resolved-source" "$toggle_auto_payload")"
bad_toggle_code="$(printf "%s" "$bad_toggle_result" | sed -n '1p')"
bad_toggle_file="$(printf "%s" "$bad_toggle_result" | sed -n '2p')"
# Depending on whether autoDetected exists for that visit, this may be 200 or 400.
if [[ "$bad_toggle_code" != "200" && "$bad_toggle_code" != "400" ]]; then
  fail "Unexpected status for auto toggle validation: $bad_toggle_code: $(jq -c . "$bad_toggle_file")"
fi

log "Final projection check"
final_projection_result="$(api_request GET "/race-rooms/${ROOM_ID}/projection")"
final_projection_code="$(printf "%s" "$final_projection_result" | sed -n '1p')"
final_projection_file="$(printf "%s" "$final_projection_result" | sed -n '2p')"
[[ "$final_projection_code" == "200" ]] || fail "Final projection fetch failed (HTTP $final_projection_code): $(jq -c . "$final_projection_file")"
json_assert "$final_projection_file" "d.get('stoppageSummary', {}).get('totalActualStopSeconds', 0) >= 0" "Invalid stoppage summary"

log "Stoppage smoke completed successfully for room ${ROOM_ID}"
