# ADR 0006: Practical E2E crew chat

## Status

Accepted (2026-05-20)

## Context

Crew chat uses Stream for transport and a per-room symmetric key for message bodies. The server must never see plaintext. Earlier device-scoped envelopes caused "missing room key" failures on reinstall and new devices.

## Decision

### Threat model (practical E2E)

- Server and Stream store ciphertext only.
- DB/leak protection for message bodies and room keys at rest on the API.
- Not nation-state grade: removed members who retained old keys may still decrypt historical ciphertext on their device.

### Identity and backup (Option A)

- One Curve25519 identity keypair per Auth0 `sub` (`chat_user_identity`).
- Encrypted backup blob on API (`chat_identity_backup`): `{ identitySecretB64, roomKeys: Record<roomId, { keyB64, keyVersion }> }` inside secretbox, keyed by a **local-only** recovery secret (never uploaded).
- Mandatory backup before chat is usable; reinstall restores from backup + server envelopes.

### Room keys and envelopes

- Per-room symmetric key (secretbox for messages).
- Envelopes keyed by `(room_id, recipient_user_id, key_version)` — user-scoped, not device-scoped.
- `chat_room_crypto_state` tracks `latest_key_version` per room.

### Membership rules

| Event | Key behavior |
|-------|----------------|
| New member joins | No rotation; existing members distribute **current** key; new member decrypts full Stream history |
| Member removed | Bump `latest_key_version`, purge envelopes; remaining members re-wrap at new version |
| Solo member, total key loss after retries | Catastrophic auto-rekey `version+1` (old history undecryptable on this device) |

### Push vs crypto

- `chat_push_devices`: `deviceId` + platform + token only.
- Crypto identity is `userId`, not `deviceId`.

### Clients

- Shared logic in `packages/chat-crypto` (no React Native imports).
- Mobile uses SecureStore adapter; web will use `localStorage` adapter (no `apps/web` screen in this ADR).

## Consequences

- Device-centric `chat_device_keys` and `recipient_device_id` envelopes are removed.
- Agents and humans validate via `npm run verify`, API chat tests, and iOS simulator per `docs/sdlc/ios-simulator-agent-qa.md`.
