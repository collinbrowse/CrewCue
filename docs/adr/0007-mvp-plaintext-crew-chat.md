# ADR 0007: MVP plaintext crew chat

## Status

Accepted (2026-07-15)

## Context

Practical E2E crew chat (ADR 0006) caused unacceptable MVP failures: chat could hang on room-key sync (“Syncing secure chat…”) and Send could no-op when no channel key was ready. For a race-crew coordination product, reliable send/receive matters more than keeping Stream from seeing message bodies.

## Decision

1. **MVP chat is plaintext on Stream.** Message bodies use Stream’s normal `text` field (plus image attachments). Opening chat only requires a Stream token, connect/watch, and send/receive.
2. **Remove the ADR 0006 crypto stack** from the product: `@crewcue/chat-crypto`, identity registration, identity backup, key envelopes, room crypto version state, and on-device push decryption bridges.
3. **Push** may include a short plaintext `previewText` or fall back to generic copy (“New Message in Crew Chat”).
4. **Future encryption** must be a **blank-slate redesign** (new ADR, new package). Do not revive room keys, envelopes, or the old backup format from ADR 0006 as the default path.

## Consequences

- Staging/historical messages that only stored ciphertext custom fields will not show readable text; new messages are plaintext.
- API surface for chat is Stream token, Stream channel sync, push devices, notification prefs, retention purge, and push webhook fan-out.
- Retention still deletes server-side chat metadata and expects operators to delete Stream channels as documented.

## References

- Supersedes [ADR 0006](./0006-practical-e2e-crew-chat.md)
- Runbooks: [chat-smoke.md](../runbooks/chat-smoke.md), [chat-push.md](../runbooks/chat-push.md), [chat-retention.md](../runbooks/chat-retention.md)
