/**
 * Mention parsing and tokenization.
 *
 * Source of truth for member display names is the `RaceRoomMembership.displayName`
 * field on the active room. Parsing finds occurrences of `@<displayName>` (case
 * insensitive, longest match wins) and emits structured tokens that the renderer
 * can use to bold the name and the push fan-out can use to elevate notification
 * priority for `@`-mentioned users.
 */
import type { RaceRoomMembership } from "@crewcue/contracts";

export type MentionToken =
  | { kind: "text"; text: string }
  | { kind: "mention"; displayName: string; userId: string };

export type MentionMember = Pick<RaceRoomMembership, "userId" | "displayName">;

/** Build a regex that matches any of the provided display names after `@`. */
function buildMentionRegex(members: readonly MentionMember[]): RegExp | null {
  const named = members
    .map((m) => (m.displayName ?? "").trim())
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length); // longest match wins
  if (named.length === 0) return null;
  const escaped = named.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`@(${escaped.join("|")})\\b`, "gi");
}

/** Tokenize a body into text + mention spans. Stable ordering. */
export function parseMentions(body: string, members: readonly MentionMember[]): MentionToken[] {
  if (body.length === 0) return [];
  const regex = buildMentionRegex(members);
  if (!regex) return [{ kind: "text", text: body }];

  const tokens: MentionToken[] = [];
  let cursor = 0;
  for (const match of body.matchAll(regex)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    if (start > cursor) {
      tokens.push({ kind: "text", text: body.slice(cursor, start) });
    }
    const matchedName = match[1] ?? "";
    const member = members.find(
      (m) => (m.displayName ?? "").trim().toLowerCase() === matchedName.trim().toLowerCase()
    );
    if (member) {
      tokens.push({
        kind: "mention",
        displayName: member.displayName ?? matchedName,
        userId: member.userId
      });
    } else {
      tokens.push({ kind: "text", text: match[0] });
    }
    cursor = start + match[0].length;
  }
  if (cursor < body.length) {
    tokens.push({ kind: "text", text: body.slice(cursor) });
  }
  return tokens;
}

/** Distinct user ids mentioned in a body (drives push fan-out priority). */
export function extractMentionedUserIds(body: string, members: readonly MentionMember[]): string[] {
  const set = new Set<string>();
  for (const tok of parseMentions(body, members)) {
    if (tok.kind === "mention") set.add(tok.userId);
  }
  return Array.from(set);
}

/** Suggest member rows for an in-progress `@<query>` token; max 10 results. */
export function suggestMentions(
  body: string,
  caretIndex: number,
  members: readonly MentionMember[]
): MentionMember[] {
  const head = body.slice(0, caretIndex);
  const triggerIdx = head.lastIndexOf("@");
  if (triggerIdx < 0) return [];
  const segment = head.slice(triggerIdx + 1);
  if (/\s/.test(segment)) return [];
  const q = segment.trim().toLowerCase();
  return members
    .filter((m) => (m.displayName ?? "").toLowerCase().startsWith(q))
    .slice(0, 10);
}
