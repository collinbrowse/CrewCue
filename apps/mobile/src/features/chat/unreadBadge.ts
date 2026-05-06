/**
 * Numeric unread count store for the Chat tab badge.
 *
 * Stream Chat already tracks per-channel unread counts; this module is a tiny
 * subscribable hub so the tab navigator (which mounts above the chat screen
 * lifecycle) can react to changes pushed by the chat screen.
 */
import { useEffect, useState } from "react";

type Listener = (count: number) => void;
const listeners = new Set<Listener>();
let current = 0;

export function setChatUnreadCount(next: number): void {
  const safe = Number.isFinite(next) && next >= 0 ? Math.floor(next) : 0;
  if (safe === current) return;
  current = safe;
  for (const l of listeners) l(current);
}

export function getChatUnreadCount(): number {
  return current;
}

export function subscribeChatUnread(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function useChatUnreadBadge(): string | undefined {
  const [count, setCount] = useState<number>(getChatUnreadCount());
  useEffect(() => subscribeChatUnread(setCount), []);
  if (!Number.isFinite(count) || count <= 0) return undefined;
  if (count > 99) return "99+";
  return String(count);
}

/**
 * Format a numeric count for display. Exposed for unit tests and pure reuse
 * outside of React components.
 */
export function formatUnreadBadge(count: number): string | undefined {
  if (!Number.isFinite(count) || count <= 0) return undefined;
  if (count > 99) return "99+";
  return String(count);
}
