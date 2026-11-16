#!/usr/bin/env bash
# One-time (and re-runnable) GitHub setup for the agent/human split.
#
#   Agents (Write-role bot): open PRs, merge them once CI is green, deploy staging via main.
#   Human (repo admin):      create v* tags and approve the `release` environment.
#
# Run as the repo ADMIN (your own gh login), never as the bot:
#   bash scripts/github-guardrails.sh <bot-login>
# Add --dry-run to print the calls without making them.
# Details: docs/runbooks/launch-owner-setup.md
set -euo pipefail

BOT="${1:-}"
DRY_RUN=false
[[ "${2:-}" == "--dry-run" || "${1:-}" == "--dry-run" ]] && DRY_RUN=true
[[ "$BOT" == "--dry-run" ]] && BOT=""

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
ME="$(gh api user -q .login)"
ME_ID="$(gh api user -q .id)"
PERM="$(gh api "repos/$REPO" -q .permissions.admin)"
if [[ "$PERM" != "true" ]]; then
  echo "Run this as a repo admin. '$ME' is not an admin of $REPO." >&2
  exit 1
fi
if [[ -n "$BOT" && "$BOT" == "$ME" ]]; then
  echo "The bot must be a separate GitHub account from you ($ME)." >&2
  exit 1
fi

call() {
  if $DRY_RUN; then echo "gh api $*"; else gh api "$@" >/dev/null; fi
}

echo "== $REPO, admin $ME =="

echo "1. Auto-merge on, branches deleted after merge"
call -X PATCH "repos/$REPO" -F allow_auto_merge=true -F delete_branch_on_merge=true

echo "2. main: required checks apply to admins too"
call -X POST "repos/$REPO/branches/main/protection/enforce_admins"
# Skipped jobs (for example ios/android when a PR does not touch them) count as passing.
call -X PATCH "repos/$REPO/branches/main/protection/required_status_checks" \
  -F strict=true \
  -f "contexts[]=dual-client-guard" \
  -f "contexts[]=checks" \
  -f "contexts[]=api-postgres-integration" \
  -f "contexts[]=pr-decision-doc-guard" \
  -f "contexts[]=ios" \
  -f "contexts[]=android"

echo "3. Release tags (v*): only admins may create, move or delete them"
RULESET_ID="$(gh api "repos/$REPO/rulesets" -q '.[] | select(.name=="release-tags") | .id')"
RULESET="$(cat <<JSON
{
  "name": "release-tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [
    { "type": "creation" }, { "type": "update" }, { "type": "deletion" }, { "type": "non_fast_forward" }
  ],
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" } ]
}
JSON
)"
if $DRY_RUN; then
  echo "gh api -X ${RULESET_ID:+PUT}${RULESET_ID:-POST} repos/$REPO/rulesets${RULESET_ID:+/$RULESET_ID} <<< release-tags ruleset"
elif [[ -n "$RULESET_ID" ]]; then
  gh api -X PUT "repos/$REPO/rulesets/$RULESET_ID" --input - <<<"$RULESET" >/dev/null
else
  gh api -X POST "repos/$REPO/rulesets" --input - <<<"$RULESET" >/dev/null
fi

echo "4. 'release' environment: your approval, v* tags only"
ENV="$(cat <<JSON
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [ { "type": "User", "id": $ME_ID } ],
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
JSON
)"
if $DRY_RUN; then
  echo "gh api -X PUT repos/$REPO/environments/release <<< reviewers=$ME, custom policies"
else
  gh api -X PUT "repos/$REPO/environments/release" --input - <<<"$ENV" >/dev/null
  if ! gh api "repos/$REPO/environments/release/deployment-branch-policies" -q '.branch_policies[] | select(.type=="tag" and .name=="v*") | .id' | grep -q .; then
    gh api -X POST "repos/$REPO/environments/release/deployment-branch-policies" -f name='v*' -f type=tag >/dev/null
  fi
fi

if [[ -n "$BOT" ]]; then
  echo "5. Invite $BOT with Write (push) access. Accept the invite while signed in as $BOT."
  call -X PUT "repos/$REPO/collaborators/$BOT" -f permission=push
else
  echo "5. Skipped bot invite (no bot login given)."
fi

cat <<EOF

Done. Still yours to do by hand (docs/runbooks/launch-owner-setup.md):
  - Move every release secret into the 'release' environment (Settings > Environments > release).
  - Add RAILWAY_TOKEN there: a Railway project token scoped to the production environment.
  - In Railway, disconnect the production service from GitHub autodeploy.
  - Sign Claude Code in to gh as the bot (GH_CONFIG_DIR), not as $ME.
EOF
