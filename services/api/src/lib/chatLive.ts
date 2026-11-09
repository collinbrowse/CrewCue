/**
 * In-process wake-ups for chat long-polls (ADR 0010).
 *
 * A waiting `GET /chat/rooms/:roomId/messages?after=…&wait=…` subscribes here and wakes when a
 * message lands in the room or the room's membership changes. Waiters re-query the store, so a
 * missed wake-up only delays delivery until the poll times out. One API replica is assumed; a
 * second replica would need Postgres LISTEN/NOTIFY behind this same interface.
 */
export type ChatLiveEvent = "message" | "membership";

type Listener = (event: ChatLiveEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeChatRoom(roomId: string, listener: Listener): () => void {
  let set = listeners.get(roomId);
  if (!set) {
    set = new Set();
    listeners.set(roomId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(roomId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(roomId);
  };
}

export function publishChatRoom(roomId: string, event: ChatLiveEvent): void {
  for (const listener of Array.from(listeners.get(roomId) ?? [])) {
    listener(event);
  }
}

/** Number of open long-polls for the room. Tests use it to know a waiter is parked. */
export function chatRoomWaiterCount(roomId: string): number {
  return listeners.get(roomId)?.size ?? 0;
}
