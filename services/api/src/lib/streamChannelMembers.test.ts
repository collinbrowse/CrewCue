import test from "node:test";
import assert from "node:assert/strict";
import type { RaceRoom } from "@crewcue/contracts";
import { deriveStreamUserId } from "./streamChat.js";
import { streamChatMembersForRoom } from "./streamChannelMembers.js";

function roomWith(memberships: RaceRoom["memberships"]): RaceRoom {
  return { id: "room-1", memberships } as RaceRoom;
}

test("streamChatMembersForRoom: maps each member to their Stream id and this room's name", () => {
  const members = streamChatMembersForRoom(
    roomWith([
      { userId: "runner", role: "athlete", joinedAt: "2026-10-15T00:00:00Z", displayName: "  Pacer Collin " },
      { userId: "crew", role: "crew_member", joinedAt: "2026-10-15T00:00:00Z" },
      { userId: "blank", role: "crew_member", joinedAt: "2026-10-15T00:00:00Z", displayName: "   " }
    ])
  );
  assert.deepEqual(members, [
    { streamUserId: deriveStreamUserId("runner"), displayName: "Pacer Collin" },
    { streamUserId: deriveStreamUserId("crew") },
    { streamUserId: deriveStreamUserId("blank") }
  ]);
});

test("streamChatMembersForRoom: keeps one entry per Stream user", () => {
  const members = streamChatMembersForRoom(
    roomWith([
      { userId: "same", role: "athlete", joinedAt: "2026-10-15T00:00:00Z", displayName: "First" },
      { userId: "same", role: "crew_member", joinedAt: "2026-10-15T00:00:00Z", displayName: "Second" }
    ])
  );
  assert.equal(members.length, 1);
});
