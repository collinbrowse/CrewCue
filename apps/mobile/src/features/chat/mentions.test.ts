import test from "node:test";
import assert from "node:assert/strict";
import { extractMentionedUserIds, parseMentions, suggestMentions } from "./mentions";

const members = [
  { userId: "u-alice", displayName: "Alice", role: "athlete" as const, joinedAt: "" },
  { userId: "u-bob", displayName: "Bob Smith", role: "crew_member" as const, joinedAt: "" },
  { userId: "u-no-name", role: "crew_member" as const, joinedAt: "" }
];

test("mentions: parses single mention and surrounding text", () => {
  const tokens = parseMentions("hi @Alice you ok?", members);
  assert.deepEqual(tokens, [
    { kind: "text", text: "hi " },
    { kind: "mention", displayName: "Alice", userId: "u-alice" },
    { kind: "text", text: " you ok?" }
  ]);
});

test("mentions: matches longer display name first", () => {
  const tokens = parseMentions("@Bob Smith ack", members);
  assert.equal(tokens[0]?.kind, "mention");
  if (tokens[0]?.kind === "mention") {
    assert.equal(tokens[0].displayName, "Bob Smith");
  }
});

test("mentions: ignores members without a display name", () => {
  const tokens = parseMentions("hello @ghost", members);
  assert.deepEqual(tokens, [{ kind: "text", text: "hello @ghost" }]);
});

test("mentions: extractMentionedUserIds is unique and ordered by appearance", () => {
  const ids = extractMentionedUserIds("@Alice @Bob Smith @Alice", members);
  assert.deepEqual(ids, ["u-alice", "u-bob"]);
});

test("mentions: suggestMentions returns prefix matches at caret", () => {
  const body = "hey @al";
  const out = suggestMentions(body, body.length, members);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.userId, "u-alice");
});

test("mentions: suggestMentions returns empty when no @ trigger", () => {
  assert.deepEqual(suggestMentions("hello bob", 9, members), []);
});

test("mentions: suggestMentions stops at whitespace after @", () => {
  const body = "@ ali";
  assert.deepEqual(suggestMentions(body, body.length, members), []);
});
