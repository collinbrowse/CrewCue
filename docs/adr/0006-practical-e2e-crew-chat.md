# ADR 0006: Practical E2E crew chat

## Status

**Superseded (2026-07-15)** by [ADR 0007](./0007-mvp-plaintext-crew-chat.md).

The practical E2E room-key / envelope / identity-backup design described below is **retired**. Do not revive this approach when adding encryption later — start from a blank slate (new ADR and new design).

Historical decision text is preserved below for archaeology only.

---

## Context (historical)

Crew chat used Stream for transport and a per-room symmetric key for message bodies. The server was never supposed to see plaintext.

## Decision (historical — superseded)

### Threat model (practical E2E)

- Server and Stream store ciphertext only.
- DB/leak protection for message bodies and room keys at rest on the API.
- Not nation-state grade: removed members who retained old keys may still decrypt historical ciphertext on their device.

### Identity and backup (Option A)

- One Curve25519 identity keypair per Auth0 `sub` (`chat_user_identity`).
- Encrypted backup blob on API (`chat_identity_backup`).
- Mandatory backup before chat is usable; reinstall restores from backup + server envelopes.

### Room keys and envelopes

- Per-room symmetric key (secretbox for messages).
- Envelopes keyed by `(room_id, recipient_user_id, key_version)`.
- `chat_room_crypto_state` tracks `latest_key_version` per room.

### Membership rules

| Event | Key behavior |
|-------|----------------|
| New member joins | No rotation; existing members distribute **current** key |
| Member removed | Bump `latest_key_version`, purge envelopes |
| Solo member, total key loss after retries | Catastrophic auto-rekey |

### Clients

- Shared logic lived in `packages/chat-crypto` (deleted under ADR 0007).

## Consequences (historical)

Device-centric envelopes were removed in favor of user-scoped envelopes. That stack still produced MVP lockouts (“Syncing secure chat…”, silent Send), which led to supersession by plaintext MVP chat.
