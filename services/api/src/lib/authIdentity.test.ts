import test from "node:test";
import assert from "node:assert/strict";
import { mapJwtPayloadToIdentity } from "./authIdentity.js";

test("maps flat dev-style claims", () => {
  const id = mapJwtPayloadToIdentity({
    sub: "user-1",
    email: "a@b.com",
    teamIds: ["t1", "t2"],
    roomRoles: { r1: "athlete", r2: "crew_chief" },
  });
  assert.deepEqual(id, {
    sub: "user-1",
    email: "a@b.com",
    teamIds: ["t1", "t2"],
    roomRoles: { r1: "athlete", r2: "crew_chief" },
  });
});

test("accepts team_ids and room_roles aliases", () => {
  const id = mapJwtPayloadToIdentity({
    sub: "user-1",
    team_ids: ["t1"],
    room_roles: { r1: "crew_member" },
  });
  assert.deepEqual(id?.sub, "user-1");
  assert.deepEqual(id?.teamIds, ["t1"]);
  assert.deepEqual(id?.roomRoles, { r1: "crew_member" });
});

test("reads namespaced custom claims", () => {
  const ns = "https://crewcue.test/";
  const id = mapJwtPayloadToIdentity(
    {
      sub: "auth0|123",
      [`${ns}team_ids`]: ["t1"],
      [`${ns}room_roles`]: { r1: "team_manager" },
    },
    { claimNamespace: ns },
  );
  assert.deepEqual(id?.teamIds, ["t1"]);
  assert.deepEqual(id?.roomRoles, { r1: "team_manager" });
});

test("rejects missing sub", () => {
  assert.equal(mapJwtPayloadToIdentity({ teamIds: [] }), undefined);
});

test("rejects invalid room role values", () => {
  assert.equal(
    mapJwtPayloadToIdentity({
      sub: "u1",
      roomRoles: { r1: "hacker" },
    }),
    undefined,
  );
});

test("coerces single string team id to array", () => {
  const id = mapJwtPayloadToIdentity({
    sub: "u1",
    teamIds: "solo-team",
    roomRoles: {},
  });
  assert.deepEqual(id?.teamIds, ["solo-team"]);
});
