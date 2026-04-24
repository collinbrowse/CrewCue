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
