/**
 * Client-side mirror of the server retention policy. Used to render the
 * "Crew chat will be removed on …" banner once an event has ended.
 *
 * The server is the actual deletion authority (services/api). This module
 * only computes display state.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const CHAT_RETENTION_DAYS_CLIENT = 30;

export function isEventEndedClient(eventEndsAt: string | undefined, now: Date = new Date()): boolean {
  if (!eventEndsAt) return false;
  const ms = Date.parse(eventEndsAt);
  if (!Number.isFinite(ms)) return false;
  return ms < now.getTime();
}

export function computeChatRemovalDateClient(eventEndsAt: string): Date | undefined {
  const ms = Date.parse(eventEndsAt);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms + CHAT_RETENTION_DAYS_CLIENT * MS_PER_DAY);
}
