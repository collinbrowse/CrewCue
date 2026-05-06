/**
 * Fixed crew chat reaction set. Locked at v1 per the approved feature list:
 * thumbs up, thumbs down, heart, laugh, surprise, cry, clap.
 *
 * Stream Chat reaction "type" strings are arbitrary, so we store the same
 * string both as the user-visible glyph and as the server-side type.
 */
export const CHAT_REACTIONS = ["👍", "👎", "❤️", "😂", "😮", "😢", "👏"] as const;
export type ChatReactionType = (typeof CHAT_REACTIONS)[number];

export function isCrewReactionType(value: unknown): value is ChatReactionType {
  return typeof value === "string" && (CHAT_REACTIONS as readonly string[]).includes(value);
}
