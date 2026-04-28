import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canMutateCheckpointStoppage,
  canMutateTaskBoard,
  canRecordMergeTelemetry,
  getCurrentRoomRole
} from "./roleGuards";
import type { AuthState } from "./useAuth";

function baseAuth(overrides: Partial<AuthState> = {}): AuthState {
  return {
    status: "authenticated",
    accessToken: "t",
    claims: { sub: "u1", roomRoles: { roomA: "crew_member" } },
    redirectUri: "https://example/callback",
    signIn: async () => {},
    signOut: async () => {},
    ...overrides
  };
}

test("canMutateCheckpointStoppage is false when not authenticated", () => {
  assert.equal(
    canMutateCheckpointStoppage(
      baseAuth({ status: "anonymous", claims: undefined, accessToken: undefined })
    ),
    false
  );
});

test("canMutateCheckpointStoppage is false without sub", () => {
  assert.equal(canMutateCheckpointStoppage(baseAuth({ claims: { roomRoles: { r: "crew_member" } } })), false);
});

test("canMutateCheckpointStoppage allows crew roles", () => {
  assert.equal(
    canMutateCheckpointStoppage(
      baseAuth({ claims: { sub: "u1", roomRoles: { r1: "crew_chief", r2: "athlete" } } })
    ),
    true
  );
});

test("canMutateCheckpointStoppage rejects athlete-only roles", () => {
  assert.equal(
    canMutateCheckpointStoppage(baseAuth({ claims: { sub: "u1", roomRoles: { r1: "athlete" } } })),
    false
  );
});

test("getCurrentRoomRole returns undefined without room id", () => {
  assert.equal(getCurrentRoomRole(baseAuth(), undefined), undefined);
});

test("getCurrentRoomRole returns role for room", () => {
  assert.equal(getCurrentRoomRole(baseAuth(), "roomA"), "crew_member");
});

test("canMutateTaskBoard matches room role", () => {
  assert.equal(canMutateTaskBoard(baseAuth(), "roomA"), true);
  const athleteOnly = baseAuth({
    claims: { sub: "u1", roomRoles: { roomA: "athlete" } }
  });
  assert.equal(canMutateTaskBoard(athleteOnly, "roomA"), false);
});

test("canRecordMergeTelemetry allows athlete, crew chief, and team manager", () => {
  assert.equal(canRecordMergeTelemetry("athlete"), true);
  assert.equal(canRecordMergeTelemetry("crew_chief"), true);
  assert.equal(canRecordMergeTelemetry("team_manager"), true);
  assert.equal(canRecordMergeTelemetry("crew_member"), false);
  assert.equal(canRecordMergeTelemetry(undefined), false);
});
