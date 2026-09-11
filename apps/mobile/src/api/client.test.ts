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
        raceStartAt: string;
        course: { checkpoints: Array<{ id: string }> };
      };
      assert.equal(body.plannedPaceSecondsPerKm, 360);
      assert.equal(body.raceStartAt, "2026-01-01T12:00:00.000Z");
      assert.equal(body.course.checkpoints[0]?.id, "aid-1");
      return new Response(JSON.stringify(minimalRoom), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await client.updateRaceCourse("room-1", {
      plannedPaceSecondsPerKm: 360,
      raceStartAt: "2026-01-01T12:00:00.000Z",
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
            permissions: {
              canViewRoom: true,
              canEditRaceSetup: false,
              canIssueInvite: false,
              canEditCheckpointStops: true
            }
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

test("getSchedule GETs /schedule and parses CrewScheduleSheet (EC1/EC5)", async () => {
  const prev = globalThis.fetch;
  try {
    const fixture = {
      roomId: "room-fixture-50k",
      raceStartAt: "2026-08-15T13:00:00.000Z",
      stops: [
        {
          id: "stop-start",
          checkpointId: "start",
          clockArrivalAt: "2026-08-15T13:00:00.000Z",
          elapsedSeconds: 0,
          plannedStoppageSeconds: 0
        },
        {
          id: "stop-aid-2",
          checkpointId: "aid-2",
          clockArrivalAt: "2026-08-15T15:20:00.000Z",
          elapsedSeconds: 8400,
          plannedStoppageSeconds: 240,
          delayOverrideSeconds: 120
        }
      ]
    };
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), "https://api.example/race-rooms/room-fixture-50k/schedule");
      assert.equal(init?.method, "GET");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers?.Authorization, "Bearer test-token");
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    const sheet = await client.getSchedule("room-fixture-50k");
    assert.equal(sheet.roomId, "room-fixture-50k");
    assert.equal(sheet.stops.length, 2);
    assert.equal(sheet.stops[0]?.delayOverrideSeconds, undefined);
    assert.equal(sheet.stops[1]?.delayOverrideSeconds, 120);
    assert.equal(sheet.stops[1]?.clockArrivalAt, "2026-08-15T15:20:00.000Z");
  } finally {
    globalThis.fetch = prev;
  }
});

test("getSchedule surfaces API 400 body via ApiError (EC2)", async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "raceStartAt required for schedule" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await assert.rejects(
      () => client.getSchedule("room-1"),
      (err: unknown) =>
        err instanceof ApiError && err.status === 400 && err.message === "raceStartAt required for schedule"
    );
  } finally {
    globalThis.fetch = prev;
  }
});

test("patchStopPlan omits unspecified fields and PATCHes partial body (EC1)", async () => {
  const prev = globalThis.fetch;
  try {
    let body: unknown;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), "https://api.example/race-rooms/room-1/stop-plans/aid-1");
      assert.equal(init?.method, "PATCH");
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          roomId: "room-1",
          checkpointId: "aid-1",
          delayOverrideSeconds: 90,
          planNotes: { id: "note-1", body: "keep me" }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    const result = await client.patchStopPlan("room-1", "aid-1", { delayOverrideSeconds: 90 });
    assert.deepEqual(body, { delayOverrideSeconds: 90 });
    assert.equal(result.delayOverrideSeconds, 90);
    assert.equal(result.planNotes?.body, "keep me");
  } finally {
    globalThis.fetch = prev;
  }
});

test("patchStopPlan rejects negative delay before fetch (EC2)", async () => {
  const prev = globalThis.fetch;
  let fetched = false;
  try {
    globalThis.fetch = async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    };
    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await assert.rejects(
      () => client.patchStopPlan("room-1", "aid-1", { delayOverrideSeconds: -1 }),
      (err: unknown) =>
        err instanceof ApiError && err.status === 400 && err.message === "Invalid stop-plan payload"
    );
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = prev;
  }
});

test("putStopPlan empty object does not send clear nulls (EC7 contrast)", async () => {
  const prev = globalThis.fetch;
  try {
    let body: unknown;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(init?.method, "PUT");
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ roomId: "room-1", checkpointId: "aid-1", delayOverrideSeconds: 120 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await client.putStopPlan("room-1", "aid-1", {});
    assert.deepEqual(body, {});
  } finally {
    globalThis.fetch = prev;
  }
});

test("patchStopPlan clears delay/notes via null (EC7)", async () => {
  const prev = globalThis.fetch;
  try {
    let body: unknown;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ roomId: "room-1", checkpointId: "aid-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await client.patchStopPlan("room-1", "aid-1", {
      delayOverrideSeconds: null,
      athleteNotes: null,
      planNotes: null
    });
    assert.deepEqual(body, {
      delayOverrideSeconds: null,
      athleteNotes: null,
      planNotes: null
    });
  } finally {
    globalThis.fetch = prev;
  }
});

test("clearStopPlan DELETEs overlay (EC7)", async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), "https://api.example/race-rooms/room-1/stop-plans/aid-2");
      assert.equal(init?.method, "DELETE");
      assert.equal(init?.body, undefined);
      return new Response(JSON.stringify({ roomId: "room-1", checkpointId: "aid-2" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    const result = await client.clearStopPlan("room-1", "aid-2");
    assert.equal(result.checkpointId, "aid-2");
    assert.equal(result.delayOverrideSeconds, undefined);
  } finally {
    globalThis.fetch = prev;
  }
});

test("patchStopPlan surfaces 403 unauthorized (EC3)", async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      });
    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await assert.rejects(
      () => client.patchStopPlan("room-1", "aid-1", { delayOverrideSeconds: 30 }),
      (err: unknown) => err instanceof ApiError && err.status === 403
    );
  } finally {
    globalThis.fetch = prev;
  }
});

test("patchStopPlan surfaces network failure without silent success (EC4)", async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch — network offline");
    };
    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await assert.rejects(() => client.patchStopPlan("room-1", "aid-1", { delayOverrideSeconds: 30 }));
  } finally {
    globalThis.fetch = prev;
  }
});

test("patchStopPlan duplicate save keeps stable note id (EC5)", async () => {
  const prev = globalThis.fetch;
  try {
    const calls: unknown[] = [];
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          roomId: "room-1",
          checkpointId: "aid-1",
          planNotes: { id: "note-stable", body: "same" }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    const input = { planNotes: { id: "note-stable", body: "same" } };
    const first = await client.patchStopPlan("room-1", "aid-1", input);
    const second = await client.patchStopPlan("room-1", "aid-1", input);
    assert.equal(calls.length, 2);
    assert.equal(first.planNotes?.id, "note-stable");
    assert.equal(second.planNotes?.id, "note-stable");
  } finally {
    globalThis.fetch = prev;
  }
});

test("getStopPlan / patchStopPlan delay unit is seconds; clocks remain ISO from schedule (EC6)", async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/stop-plans/aid-2") && init?.method === "GET") {
        return new Response(
          JSON.stringify({ roomId: "room-1", checkpointId: "aid-2", delayOverrideSeconds: 120 }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.endsWith("/schedule")) {
        return new Response(
          JSON.stringify({
            roomId: "room-1",
            raceStartAt: "2026-08-15T13:00:00.000Z",
            stops: [
              {
                id: "stop-aid-2",
                checkpointId: "aid-2",
                clockArrivalAt: "2026-08-15T15:20:00.000Z",
                elapsedSeconds: 8400,
                plannedStoppageSeconds: 240,
                delayOverrideSeconds: 120
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    const plan = await client.getStopPlan("room-1", "aid-2");
    assert.equal(plan.delayOverrideSeconds, 120);
    const sheet = await client.getSchedule("room-1");
    assert.equal(sheet.stops[0]?.clockArrivalAt, "2026-08-15T15:20:00.000Z");
  } finally {
    globalThis.fetch = prev;
  }
});

test("postManualCheckpointStop POSTs manual-stop then client can refetch schedule", async () => {
  const prev = globalThis.fetch;
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, url, body });
    if (url.includes("/manual-stop") && method === "POST") {
      return new Response(
        JSON.stringify({
          checkpointSplit: {
            checkpointId: "aid-1",
            visits: [
              {
                visitIndex: 1,
                resolvedSource: "manual_crew",
                activeActualStopSeconds: 480,
                manualEntry: {
                  arrivalAt: "2026-08-15T14:10:00.000Z",
                  departureAt: "2026-08-15T14:18:00.000Z",
                  actualStopSeconds: 480,
                  recordedByUserId: "u1"
                }
              }
            ]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.endsWith("/schedule")) {
      return new Response(
        JSON.stringify({
          roomId: "room-1",
          raceStartAt: "2026-08-15T13:00:00.000Z",
          stops: [
            {
              id: "stop-aid-1",
              checkpointId: "aid-1",
              clockArrivalAt: "2026-08-15T14:10:00.000Z",
              elapsedSeconds: 4200,
              plannedStoppageSeconds: 180
            },
            {
              id: "stop-aid-2",
              checkpointId: "aid-2",
              clockArrivalAt: "2026-08-15T15:25:00.000Z",
              elapsedSeconds: 8700,
              plannedStoppageSeconds: 240
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error(`unexpected ${url}`);
  };
  try {
    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await client.postManualCheckpointStop("room-1", "aid-1", {
      arrivalAt: "2026-08-15T14:10:00.000Z",
      departureAt: "2026-08-15T14:18:00.000Z"
    });
    const sheet = await client.getSchedule("room-1");
    assert.equal(sheet.stops[1]?.clockArrivalAt, "2026-08-15T15:25:00.000Z");
    assert.equal(calls[0]?.method, "POST");
    assert.match(calls[0]?.url ?? "", /\/checkpoints\/aid-1\/manual-stop$/);
  } finally {
    globalThis.fetch = prev;
  }
});

test("postManualCheckpointStop rejects arrival-only before network (EC1)", async () => {
  const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
  await assert.rejects(
    () =>
      client.postManualCheckpointStop("room-1", "aid-1", {
        arrivalAt: "2026-08-15T14:10:00.000Z",
        departureAt: ""
      }),
    (err: unknown) => err instanceof ApiError && err.status === 400
  );
});

test("Strava client methods hit /strava/* paths", async () => {
  const calls: Array<{ method: string; url: string }> = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ method: init?.method ?? "GET", url });
    return new Response(JSON.stringify({ connected: false, authorizeUrl: "https://strava.test", state: "s" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
  try {
    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    await client.startStravaOAuth();
    await client.getStravaConnection();
    await client.completeStravaOAuth({ code: "c", state: "s" });
    await client.syncStravaActivities();
    await client.disconnectStrava();
    assert.equal(calls[0]?.url, "https://api.example/strava/oauth/start");
    assert.equal(calls[0]?.method, "GET");
    assert.equal(calls[1]?.url, "https://api.example/strava/connection");
    assert.equal(calls[2]?.method, "POST");
    assert.equal(calls[2]?.url, "https://api.example/strava/oauth/callback");
    assert.equal(calls[3]?.url, "https://api.example/strava/sync");
    assert.equal(calls[4]?.method, "DELETE");
  } finally {
    globalThis.fetch = prev;
  }
});

test("activity history client methods hit /activity-history paths", async () => {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const prev = globalThis.fetch;
  const historyRef = {
    id: "hist-1",
    source: "gpx_upload",
    externalId: "gpx:test",
    recordedAt: "2026-01-01T12:00:00.000Z",
    ingestedAt: "2026-01-02T12:00:00.000Z",
    distanceMeters: 10000,
    elapsedSeconds: 3600
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({
      method: init?.method ?? "GET",
      url,
      body: typeof init?.body === "string" ? init.body : undefined
    });
    if (url.endsWith("/activity-history/gpx") || (url.endsWith("/activity-history") && (init?.method ?? "GET") === "POST")) {
      return new Response(JSON.stringify(historyRef), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ items: [historyRef] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
  try {
    const client = createApiClient({ baseUrl: "https://api.example", accessToken: "test-token" });
    const metricsIngested = await client.ingestActivityHistoryMetrics({
      externalId: "gpx:test",
      distanceMeters: 10000,
      elapsedSeconds: 3600
    });
    const ingested = await client.ingestActivityHistoryGpx({
      gpxXml: "<gpx></gpx>",
      externalId: "gpx:test"
    });
    const listed = await client.listActivityHistory();
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.url, "https://api.example/activity-history");
    assert.match(calls[0]?.body ?? "", /distanceMeters/);
    assert.equal(metricsIngested.id, "hist-1");
    assert.equal(calls[1]?.method, "POST");
    assert.equal(calls[1]?.url, "https://api.example/activity-history/gpx");
    assert.match(calls[1]?.body ?? "", /gpxXml/);
    assert.equal(ingested.id, "hist-1");
    assert.equal(calls[2]?.method, "GET");
    assert.equal(calls[2]?.url, "https://api.example/activity-history");
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0]?.source, "gpx_upload");
  } finally {
    globalThis.fetch = prev;
  }
});
