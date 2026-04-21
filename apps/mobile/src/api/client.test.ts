import test from "node:test";
import assert from "node:assert/strict";
import type { RaceRoom } from "@crewcue/contracts";
import { ApiError, createApiClient } from "./client";

const minimalRoom: RaceRoom = {
  id: "room-1",
  teamId: "team-1",
  athleteId: "ath-1",
  name: "T",
  status: "draft",
  createdAt: "2026-01-01T00:00:00.000Z",
  memberships: [],
  entitlement: {
    status: "unpaid",
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    source: "manual"
  }
};

test("createRaceRoom sends Bearer token and JSON body", async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      assert.ok(url.endsWith("/race-rooms"));
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers?.Authorization, "Bearer test-token");
      assert.equal(headers?.Accept, "application/json");
      assert.equal(headers?.["Content-Type"], "application/json");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.teamId, "team-1");
      assert.equal(body.athleteId, "ath-1");
      assert.equal(body.name, "Room name");
      return new Response(JSON.stringify(minimalRoom), {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    };

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    const room = await client.createRaceRoom({
      teamId: "team-1",
      athleteId: "ath-1",
      name: "Room name"
    });
    assert.equal(room.id, "room-1");
  } finally {
    globalThis.fetch = prev;
  }
});

test("request throws ApiError with server error message", async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Entitlement unpaid" }), {
        status: 402,
        headers: { "content-type": "application/json" }
      });

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await assert.rejects(
      () => client.getRaceRoom("rid"),
      (err: unknown) => err instanceof ApiError && err.status === 402 && err.message === "Entitlement unpaid"
    );
  } finally {
    globalThis.fetch = prev;
  }
});
