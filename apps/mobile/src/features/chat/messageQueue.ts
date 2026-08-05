/**
 * Outbox-style queue for chat sends. Survives app restarts so a failed send
 * (network drop, app kill) can be retried unlimited times until the user
 * deletes it or it succeeds.
 *
 * SecureStore I/O uses a static import so Metro does not split a lazy chunk
 * that only loads on first chat navigation (see `chat/nativeDependencyPrewarm`).
 *
 * Mutations are serialized per room (see `messageQueueStore`) so concurrent
 * enqueue / markSent / removeEntry cannot last-write-wins drop entries.
 */
import * as SecureStore from "../../storage/secureStorage";
import { createChatOutboxStore } from "./messageQueueStore";

export type { ChatSendStatus, ChatOutboxEntry, ChatOutbox, EnqueueChatMessageInput } from "./messageQueueCore";
export { makeEntry, transitionEntry } from "./messageQueueCore";
export type { ChatOutboxKv, ChatOutboxStore } from "./messageQueueStore";
export { createChatOutboxStore } from "./messageQueueStore";

const store = createChatOutboxStore(SecureStore);

export const loadOutbox = store.loadOutbox.bind(store);
export const enqueueChatMessage = store.enqueueChatMessage.bind(store);
export const markSending = store.markSending.bind(store);
export const markSent = store.markSent.bind(store);
export const markFailed = store.markFailed.bind(store);
export const removeEntry = store.removeEntry.bind(store);
export const reapSent = store.reapSent.bind(store);
