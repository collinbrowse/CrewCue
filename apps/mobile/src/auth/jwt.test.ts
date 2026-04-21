import test from "node:test";
import assert from "node:assert/strict";
import { decodeAccessTokenClaims } from "./jwt";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

test("decodeAccessTokenClaims returns undefined for malformed token", () => {
  assert.equal(decodeAccessTokenClaims(""), undefined);
  assert.equal(decodeAccessTokenClaims("not-a-jwt"), undefined);
});

test("decodeAccessTokenClaims reads sub, team_ids, and room_roles aliases", () => {
  const payload = b64url({
    sub: "auth0|123",
    email: "a@b.com",
    team_ids: ["team-a", "team-b"],
    room_roles: { "room-1": "crew_chief" },
    exp: 9999999999
  });
  const token = `e30.${payload}.sig`;
  const claims = decodeAccessTokenClaims(token);
  assert.deepEqual(claims?.sub, "auth0|123");
  assert.deepEqual(claims?.email, "a@b.com");
  assert.deepEqual(claims?.teamIds, ["team-a", "team-b"]);
  assert.deepEqual(claims?.roomRoles, { "room-1": "crew_chief" });
  assert.equal(claims?.exp, 9999999999);
});

test("decodeAccessTokenClaims accepts namespaced teamIds key", () => {
  const payload = b64url({
    sub: "u1",
    teamIds: ["x"]
  });
  const claims = decodeAccessTokenClaims(`e30.${payload}.x`);
  assert.deepEqual(claims?.teamIds, ["x"]);
});
