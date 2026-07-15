import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { chatChannelIdForRoom, type RaceRoom } from "@crewcue/contracts";
import { deriveStreamUserId } from "./streamChat.js";
import {
  resetStreamClientFactoryForTests,
  setStreamClientFactoryForTests,
  syncRaceRoomStreamChannelMembers
} from "./streamChannelMembers.js";

type StreamUser = { id: string; name?: string };
type ChannelOptions = { created_by_id: string; members: string[] };

type FakeStreamCalls = {
  credentials: Array<{ apiKey: string; apiSecret: string }>;
  upsertedUsers: StreamUser[][];
  channels: Array<{ type: string; id: string; options: ChannelOptions }>;
  addMembers: string[][];
  removeMembers: string[][];
  warnings: unknown[];
};

function buildRoom(
  id: string,
  memberships: Array<{ userId: string; displayName?: string }>
): RaceRoom {
  return {
    id,
    teamId: "team-stream",
    athleteId: memberships[0]?.userId ?? "athlete-stream",
    name: "Stream Test Room",
    status: "active",
    createdAt: "2026-05-01T00:00:00.000Z",
    memberships: memberships.map((member, index) => ({
      userId: member.userId,
      role: index === 0 ? "athlete" : "crew_member",
      joinedAt: "2026-05-01T00:00:00.000Z",
      displayName: member.displayName
    })),
    entitlement: {
      status: "paid",
      lastUpdatedAt: "2026-05-01T00:00:00.000Z",
      source: "manual"
    }
  };
}

function installFakeStreamClient(
  t: TestContext,
  options: {
    initialMembers?: Record<string, unknown>;
    createError?: unknown;
  } = {}
): FakeStreamCalls {
  const previousApiKey = process.env.STREAM_API_KEY;
  const previousApiSecret = process.env.STREAM_API_SECRET;
  process.env.STREAM_API_KEY = "test-stream-key";
  process.env.STREAM_API_SECRET = "test-stream-secret";

  const calls: FakeStreamCalls = {
    credentials: [],
    upsertedUsers: [],
    channels: [],
    addMembers: [],
    removeMembers: [],
    warnings: []
  };

  const channel = {
    state: { members: options.initialMembers ?? {} },
    create: async () => {
      if (options.createError) {
        throw options.createError;
      }
    },
    query: async () => {},
    addMembers: async (memberIds: string[]) => {
      calls.addMembers.push([...memberIds]);
    },
    removeMembers: async (memberIds: string[]) => {
      calls.removeMembers.push([...memberIds]);
    }
  };

  setStreamClientFactoryForTests((apiKey, apiSecret) => {
    calls.credentials.push({ apiKey, apiSecret });
    return {
      upsertUsers: async (users: StreamUser[]) => {
        calls.upsertedUsers.push(users.map((user) => ({ ...user })));
      },
      channel: (type, id, channelOptions) => {
        calls.channels.push({ type, id, options: { ...channelOptions } });
        return channel;
      }
    };
  });

  t.after(() => {
    if (previousApiKey === undefined) {
      delete process.env.STREAM_API_KEY;
    } else {
      process.env.STREAM_API_KEY = previousApiKey;
    }
    if (previousApiSecret === undefined) {
      delete process.env.STREAM_API_SECRET;
    } else {
      process.env.STREAM_API_SECRET = previousApiSecret;
    }
    resetStreamClientFactoryForTests();
  });

  return calls;
}

test("syncRaceRoomStreamChannelMembers upserts the roster and removes stale Stream members", async (t) => {
  const athleteStreamId = deriveStreamUserId("auth0|athlete-stream");
  const crewStreamId = deriveStreamUserId("auth0|crew-stream");
  const staleStreamId = deriveStreamUserId("auth0|removed-stream");
  const calls = installFakeStreamClient(t, {
    initialMembers: {
      [athleteStreamId]: {},
      [crewStreamId]: {},
      [staleStreamId]: {}
    }
  });

  await syncRaceRoomStreamChannelMembers(
    buildRoom("room-stream-roster", [
      { userId: "auth0|athlete-stream", displayName: "  Athlete One  " },
      { userId: "auth0|crew-stream", displayName: "Crew One" },
      { userId: "auth0|crew-stream", displayName: "Crew One" }
    ])
  );

  assert.deepEqual(calls.credentials, [
    { apiKey: "test-stream-key", apiSecret: "test-stream-secret" }
  ]);
  assert.deepEqual(calls.upsertedUsers, [
    [
      { id: athleteStreamId, name: "Athlete One" },
      { id: crewStreamId, name: "Crew One" }
    ]
  ]);
  assert.deepEqual(calls.channels, [
    {
      type: "messaging",
      id: chatChannelIdForRoom("room-stream-roster"),
      options: {
        created_by_id: athleteStreamId,
        members: [athleteStreamId, crewStreamId]
      }
    }
  ]);
  assert.deepEqual(calls.addMembers, [[athleteStreamId, crewStreamId]]);
  assert.deepEqual(calls.removeMembers, [[staleStreamId]]);
});

test("syncRaceRoomStreamChannelMembers keeps syncing after duplicate create and never removes on empty snapshots", async (t) => {
  const athleteStreamId = deriveStreamUserId("athlete-empty-snapshot");
  const crewStreamId = deriveStreamUserId("crew-empty-snapshot");
  const calls = installFakeStreamClient(t, {
    initialMembers: {},
    createError: { status: 409, message: "channel already exists" }
  });

  await syncRaceRoomStreamChannelMembers(
    buildRoom("room-stream-empty-snapshot", [
      { userId: "athlete-empty-snapshot", displayName: "Athlete" },
      { userId: "crew-empty-snapshot", displayName: "   " }
    ])
  );

  assert.deepEqual(calls.upsertedUsers, [
    [{ id: athleteStreamId, name: "Athlete" }, { id: crewStreamId }]
  ]);
  assert.deepEqual(calls.addMembers, [[athleteStreamId, crewStreamId]]);
  assert.deepEqual(calls.removeMembers, []);
});
