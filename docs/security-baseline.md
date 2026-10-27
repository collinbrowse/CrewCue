# Security baseline

What is enforced today, and where.

## Identity and access

- Auth0 issues access tokens. The API verifies RS256 JWTs against `AUTH0_ISSUER` / `AUTH0_AUDIENCE` (`services/api/src/plugins/auth.ts`, `lib/auth0Jwt.ts`). Without those variables it falls back to HS256 `JWT_SECRET`, which is for local and test use only.
- Room access is checked per request from membership roles (`athlete`, `crew_member`, `crew_chief`, `team_manager`) before handlers run.
- `services/api/src/plugins/audit.ts` writes a request-level `audit_log` line with actor metadata.

## Secrets

- Never commit real secrets. Only `*.example` env files are tracked (`.gitignore`).
- Deployed API secrets live in Railway variables. CI and release secrets live in GitHub Actions environments.
- Native apps ship only public identifiers (Auth0 domain and client id, API base URL, Stream public key). Management credentials never go into an app.

## Client data (requirements for native auth; not built yet)

- Store session tokens in the Keychain (iOS) or an encrypted keystore-backed store (Android). Never in plain files or SharedPreferences.
- Signing out clears the session and any locally queued outbox data.

## Supply chain

- `npm install` runs from the committed lockfile. Swift dependencies are pinned in `Package.resolved`.
