import test from "node:test";
import assert from "node:assert/strict";
import { StreamChat } from "stream-chat";
import { chatChannelIdForRoom, type RaceRoom } from "@crewcue/contracts";
import { syncRaceRoomStreamChannelMembers } from "./streamChannelMembers.js";
import { deriveStreamUserId } from "./streamChat.js";

type StreamUserUpsert = { id: string; name?: string };

function roomWithMembers(
  memberships: RaceRoom["memberships"],
  overrides: Partial<RaceRoom> = {}
): RaceRoom {
  return {
    id: "room-stream",
    teamId: "team-stream",
    athleteId: "athlete-1",
    name: "Stream Room",
    status: "active",
    createdAt: "2026-05-20T12:00:00.000Z",
    memberships,
    entitlement: {
      status: "paid",
      lastUpdatedAt: "2026-05-20T12:00:00.000Z",
      source: "manual"
    },
    ...overrides
  };
}

function buildMembership(
  userId: string,
  displayName?: string
): RaceRoom["memberships"][number] {
  return {
    userId,
    role: "crew_member",
    joinedAt: "2026-05-20T12:00:00.000Z",
    displayName
  };
}

function installFakeStreamClient(options: {
  initialMemberIds?: string[];
  createError?: unknown;
}) {
  const calls = {
    getInstanceArgs: [] as unknown[],
    upsertUsers: [] as StreamUserUpsert[][],
    channelArgs: [] as unknown[],
    createCount: 0,
    queryArgs: [] as unknown[],
    addMembers: [] as string[][],
    removeMembers: [] as string[][]
  };

  const channel = {
    state: {
      members: Object.fromEntries((options.initialMemberIds ?? []).map((id) => [id, {}]))
    },
    async create() {
      calls.createCount += 1;
      if (options.createError) {
        throw options.createError;
      }
    },
    async query(args: unknown) {
      calls.queryArgs.push(args);
    },
    async addMembers(memberIds: string[]) {
      calls.addMembers.push([...memberIds]);
    },
    async removeMembers(memberIds: string[]) {
      calls.removeMembers.push([...memberIds]);
    }
  };

  const client = {
    async upsertUsers(users: StreamUserUpsert[]) {
      calls.upsertUsers.push(users.map((user) => ({ ...user })));
    },
    channel(...args: unknown[]) {
      calls.channelArgs = args;
      return channel;
    }
  };

  const streamChatClass = StreamChat as unknown as {
    getInstance: (...args: unknown[]) => unknown;
  };
  const originalGetInstance = streamChatClass.getInstance;
  streamChatClass.getInstance = (...args: unknown[]) => {
    calls.getInstanceArgs = args;
    return client;
  };

  return {
    calls,
    restore() {
      streamChatClass.getInstance = originalGetInstance;
    }
  };
}

async function withStreamCredentials(fn: () => Promise<void>) {
  const originalApiKey = process.env.STREAM_API_KEY;
  const originalApiSecret = process.env.STREAM_API_SECRET;
  process.env.STREAM_API_KEY = "test-stream-key";
  process.env.STREAM_API_SECRET = "test-stream-secret";
  try {
    await fn();
  } finally {
    if (originalApiKey === undefined) delete process.env.STREAM_API_KEY;
    else process.env.STREAM_API_KEY = originalApiKey;
    if (originalApiSecret === undefined) delete process.env.STREAM_API_SECRET;
    else process.env.STREAM_API_SECRET = originalApiSecret;
  }
}

test("syncRaceRoomStreamChannelMembers reconciles the full roster and removes stale Stream members", async () => {
  const athleteStreamId = deriveStreamUserId("athlete-1");
  const crewStreamId = deriveStreamUserId("crew-1");
  const staleStreamId = deriveStreamUserId("removed-member");
  const fakeStream = installFakeStreamClient({
    initialMemberIds: [athleteStreamId, crewStreamId, staleStreamId],
    createError: { status: 409, message: "channel already exists" }
  });

  try {
    await withStreamCredentials(async () => {
      await syncRaceRoomStreamChannelMembers(
        roomWithMembers([
          { ...buildMembership("athlete-1", "  Athlete One  "), role: "athlete" },
          buildMembership("crew-1", "   ")
        ])
      );
    });
  } finally {
    fakeStream.restore();
  }

  assert.deepEqual(fakeStream.calls.getInstanceArgs, [
    "test-stream-key",
    "test-stream-secret",
    { timeout: 20_000 }
  ]);
  assert.deepEqual(fakeStream.calls.upsertUsers, [
    [{ id: athleteStreamId, name: "Athlete One" }, { id: crewStreamId }]
  ]);
  assert.deepEqual(fakeStream.calls.channelArgs, [
    "messaging",
    chatChannelIdForRoom("room-stream"),
    { created_by_id: athleteStreamId, members: [athleteStreamId, crewStreamId] }
  ]);
  assert.equal(fakeStream.calls.createCount, 1);
  assert.deepEqual(fakeStream.calls.queryArgs, [
    { state: true, messages: { limit: 0 }, members: { limit: 100 } }
  ]);
  assert.deepEqual(fakeStream.calls.addMembers, [[athleteStreamId, crewStreamId]]);
  assert.deepEqual(fakeStream.calls.removeMembers, [[staleStreamId]]);
});

test("syncRaceRoomStreamChannelMembers does not remove members when Stream returns an empty snapshot", async () => {
  const athleteStreamId = deriveStreamUserId("athlete-1");
  const fakeStream = installFakeStreamClient({ initialMemberIds: [] });

  try {
    await withStreamCredentials(async () => {
      await syncRaceRoomStreamChannelMembers(
        roomWithMembers([{ ...buildMembership("athlete-1", "Athlete One"), role: "athlete" }])
      );
    });
  } finally {
    fakeStream.restore();
  }

  assert.deepEqual(fakeStream.calls.upsertUsers, [[{ id: athleteStreamId, name: "Athlete One" }]]);
  assert.deepEqual(fakeStream.calls.addMembers, [[athleteStreamId]]);
  assert.deepEqual(fakeStream.calls.removeMembers, []);
});
