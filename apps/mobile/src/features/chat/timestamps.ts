/**
 * Timestamp formatting helpers for crew chat. Each rendered message exposes
 * both `sentAt` (when the user composed it) and `arrivedAt` (when Stream
 * accepted it) — these can diverge when a sender was offline and the message
 * sat in the queue.
 *
 * The "second line" (arrival time) is suppressed unless the gap is at least
 * 30 seconds, to avoid clutter on healthy real-time sessions.
 */
const ARRIVAL_DISPLAY_THRESHOLD_MS = 30_000;

export function formatHHMM(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function shouldShowArrivalTime(sentAt: Date, arrivedAt: Date | undefined): boolean {
  if (!arrivedAt) return false;
  return Math.abs(arrivedAt.getTime() - sentAt.getTime()) >= ARRIVAL_DISPLAY_THRESHOLD_MS;
}

export type ChatTimestampDisplay = {
  sent: string;
  arrived?: string;
};

export function formatChatTimestamp(sentAt: Date, arrivedAt?: Date): ChatTimestampDisplay {
  const sent = formatHHMM(sentAt);
  if (!shouldShowArrivalTime(sentAt, arrivedAt) || !arrivedAt) {
    return { sent };
  }
  return { sent, arrived: formatHHMM(arrivedAt) };
}
