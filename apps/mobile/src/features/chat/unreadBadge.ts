/**
 * Numeric unread count for the Chat tab badge.
 *
 * Stream Chat already tracks per-channel unread counts; we just normalize the
 * value into something the React Navigation tab badge accepts (string or
 * undefined to hide the badge entirely).
 */
import type { Channel } from "stream-chat";

export function deriveUnreadBadge(channel: Channel | undefined): string | undefined {
  if (!channel) return undefined;
  const raw = channel.countUnread();
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  if (raw > 99) return "99+";
  return String(raw);
}
