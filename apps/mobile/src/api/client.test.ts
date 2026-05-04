import test from "node:test";
import assert from "node:assert/strict";
import type { RaceRoom } from "@crewcue/contracts";
import { ApiError, createApiClient } from "./client";

const minimalRoom: RaceRoom = {
  id: "room-1",
  joinCode: "000001",
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

test("request strips trailing slash from baseUrl when calling fetch", async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      assert.equal(String(input), "https://api.example.com/race-rooms/rid");
      return new Response(JSON.stringify(minimalRoom), { status: 200, headers: { "content-type": "application/json" } });
    };

    const client = createApiClient({ baseUrl: "https://api.example.com/", accessToken: "test-token" });
    await client.getRaceRoom("rid");
  } finally {
    globalThis.fetch = prev;
  }
});

test("request throws ApiError including Fastify message for route 404", async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          statusCode: 404,
          error: "Not Found",
          message: "Route GET:/race-rooms/rid/map-workspace not found"
        }),
        { status: 404, headers: { "content-type": "application/json" } }
      );

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await assert.rejects(
      () => client.getMapWorkspace("rid"),
      (err: unknown) =>
        err instanceof ApiError &&
        err.status === 404 &&
        err.message === "Not Found — Route GET:/race-rooms/rid/map-workspace not found"
    );
  } finally {
    globalThis.fetch = prev;
  }
});

test("request augments bare Not Found 404 with method and path", async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await assert.rejects(
      () => client.getMapWorkspace("rid"),
      (err: unknown) =>
        err instanceof ApiError &&
        err.status === 404 &&
        err.message === "Not Found (GET /race-rooms/rid/map-workspace)"
    );
  } finally {
    globalThis.fetch = prev;
  }
});

test("ws4 client methods target incident and recommendation endpoints", async () => {
  const prev = globalThis.fetch;
  try {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });

      if (url.endsWith("/incidents")) {
        return new Response(
          JSON.stringify({
            incident: {
              id: "inc-1",
              roomId: "room-1",
              category: "fuel",
              severity: "medium",
              summary: "Low intake",
              reportedByUserId: "user-1",
              recordedAt: "2026-04-24T00:00:00.000Z"
            }
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }

      if (url.endsWith("/incidents/inc-1/recommendations")) {
        return new Response(
          JSON.stringify({
            recommendation: {
              id: "rec-1",
              roomId: "room-1",
              incidentId: "inc-1",
              rationale: "stub",
              proposedSummary: "adjust fueling",
              status: "pending",
              createdAt: "2026-04-24T00:00:00.000Z"
            },
            explainability: {
              id: "exp-1",
              recommendationId: "rec-1",
              factors: ["fuel", "medium"],
              createdAt: "2026-04-24T00:00:00.000Z"
            }
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }

      if (url.endsWith("/recommendations/rec-1/accept")) {
        return new Response(
          JSON.stringify({
            recommendation: {
              id: "rec-1",
              roomId: "room-1",
              incidentId: "inc-1",
              rationale: "stub",
              proposedSummary: "adjust fueling",
              status: "accepted",
              createdAt: "2026-04-24T00:00:00.000Z",
              decidedAt: "2026-04-24T00:05:00.000Z",
              decidedByUserId: "user-1"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.endsWith("/plan-delta")) {
        return new Response(
          JSON.stringify({
            planDelta: { roomId: "room-1", fromVersion: 1, toVersion: 2, changes: ["increase fueling checks"] }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await client.postIncident("room-1", {
      category: "fuel",
      severity: "medium",
      summary: "Low intake"
    });
    await client.generateRecommendation("room-1", "inc-1");
    await client.acceptRecommendation("room-1", "rec-1");
    const planDelta = await client.getPlanDelta("room-1");

    assert.equal(planDelta.planDelta?.toVersion, 2);
    assert.equal(calls.length, 4);
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[1]?.url.endsWith("/incidents/inc-1/recommendations"), true);
    assert.equal(calls[2]?.url.endsWith("/recommendations/rec-1/accept"), true);
    assert.equal(calls[3]?.url.endsWith("/plan-delta"), true);
  } finally {
    globalThis.fetch = prev;
  }
});

test("WS5 sync client uses queue-diagnostics and merge-records paths", async () => {
  const prev = globalThis.fetch;
  try {
    const calls: string[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/sync/queue-diagnostics") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ diagnostics: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/sync/merge-records") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ mergeRecords: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    };

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await client.getQueueDiagnostics("room-z", { limit: 15 });
    await client.getMergeRecords("room-z", { limit: 10 });
    assert.ok(calls[0]?.includes("/race-rooms/room-z/sync/queue-diagnostics?limit=15"));
    assert.ok(calls[1]?.includes("/race-rooms/room-z/sync/merge-records?limit=10"));
  } finally {
    globalThis.fetch = prev;
  }
});

test("updateRaceCourse sends room course payload", async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      assert.ok(url.endsWith("/race-rooms/room-1/course"));
      assert.equal(init?.method, "PUT");
      const body = JSON.parse(String(init?.body)) as {
        plannedPaceSecondsPerKm: number;
        course: { checkpoints: Array<{ id: string }> };
      };
      assert.equal(body.plannedPaceSecondsPerKm, 360);
      assert.equal(body.course.checkpoints[0]?.id, "aid-1");
      return new Response(JSON.stringify(minimalRoom), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await client.updateRaceCourse("room-1", {
      plannedPaceSecondsPerKm: 360,
      course: {
        checkpoints: [
          { id: "aid-1", latitude: 40.7, longitude: -74.0 },
          { id: "aid-2", latitude: 40.8, longitude: -73.9 }
        ]
      }
    });
  } finally {
    globalThis.fetch = prev;
  }
});

test("invite client methods target room invite endpoints", async () => {
  const prev = globalThis.fetch;
  try {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/invites") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            token: "invite-1",
            roomId: "room-1",
            email: "crew@example.com",
            role: "crew_member",
            expiresAt: "2026-05-01T00:00:00.000Z"
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }
      if (url.endsWith("/invites") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ invites: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    };

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await client.issueInvite("room-1", { email: "crew@example.com", role: "crew_member" });
    await client.getInvites("room-1");
    assert.equal(calls[0]?.url.endsWith("/race-rooms/room-1/invites"), true);
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[1]?.url.endsWith("/race-rooms/room-1/invites"), true);
  } finally {
    globalThis.fetch = prev;
  }
});

test("joinRaceRoomByCode targets join-by-code endpoint", async () => {
  const prev = globalThis.fetch;
  try {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/join-by-code")) {
        return new Response(
          JSON.stringify({
            room: minimalRoom,
            assignedRole: "crew_member",
            permissions: { canViewRoom: true, canActivateRoom: false, canIssueInvite: false }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`Unexpected URL ${url}`);
    };

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await client.joinRaceRoomByCode({ roomCode: "123456" });
    assert.equal(calls[0]?.url.endsWith("/race-rooms/join-by-code"), true);
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.body, JSON.stringify({ roomCode: "123456" }));
  } finally {
    globalThis.fetch = prev;
  }
});

test("listTeamRaceRooms targets team race-room listing endpoint", async () => {
  const prev = globalThis.fetch;
  try {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url.includes("/teams/team-1/race-rooms")) {
        return new Response(JSON.stringify({ rooms: [minimalRoom] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    };

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    const response = await client.listTeamRaceRooms("team-1");
    assert.equal(response.rooms.length, 1);
    assert.equal(calls[0]?.url.includes("/teams/team-1/race-rooms"), true);
  } finally {
    globalThis.fetch = prev;
  }
});

test("listMyRaceRooms targets membership-scoped listing endpoint", async () => {
  const prev = globalThis.fetch;
  try {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url.endsWith("/race-rooms/mine")) {
        return new Response(JSON.stringify({ rooms: [minimalRoom] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    };

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    const response = await client.listMyRaceRooms();
    assert.equal(response.rooms.length, 1);
    assert.equal(calls[0]?.url.endsWith("/race-rooms/mine"), true);
    assert.equal(calls[0]?.method, "GET");
  } finally {
    globalThis.fetch = prev;
  }
});
