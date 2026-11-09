import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRoutes,
  parseMigrations,
  parseImports,
  parseEnvReads,
  parseSwiftTypes,
  countMarkers,
  findTimers
} from "./kbParse.mjs";

test("routes: method, path, line, and guard per handler", () => {
  const text = [
    'app.get("/health/live", async () => ({ ok: true }));',
    'app.post("/rooms/:roomId/pings", async (request, reply) => {',
    "  if (!request.identity) return reply.code(401).send();",
    "  const m = room.memberships.find((x) => x.userId === request.identity.sub);",
    "});",
    'app.delete("/rooms/:roomId", async (request, reply) => {',
    "  const room = await requireCourseEditor(app, request, reply, id);",
    "});",
    'app.get("/rooms/:roomId/raw", async (request) => {',
    "  if (!request.identity) return;",
    "});"
  ].join("\n");
  assert.deepEqual(
    parseRoutes(text).map((r) => [r.method, r.path, r.line, r.guard]),
    [
      ["GET", "/health/live", 1, "none detected"],
      ["POST", "/rooms/:roomId/pings", 2, "identity + membership"],
      ["DELETE", "/rooms/:roomId", 6, "course-editor"],
      ["GET", "/rooms/:roomId/raw", 9, "identity"]
    ]
  );
});

test("routes: guard found through one helper call", () => {
  const text = [
    "async function upsert(app, request, reply) {",
    "  const room = await requireRoomMember(app, request, reply, id);",
    "}",
    "export async function routes(app) {",
    '  app.put("/x", async (request, reply) => upsert(app, request, reply));',
    "}"
  ].join("\n");
  assert.equal(parseRoutes(text)[0].guard, "room-member (via upsert)");
});

test("routes: owner check and webhook secret", () => {
  const owner = 'app.delete("/r/:roomId", async (request) => { if (!request.identity) return; if (room.athleteId !== request.identity.sub) return; });';
  assert.equal(parseRoutes(owner)[0].guard, "identity + owner");
  const hook = 'app.post("/hook", async (request) => { const a = request.identity?.sub; if (!a && !hasValidPushWebhookSecret(request)) return; });';
  assert.equal(parseRoutes(hook)[0].guard, "identity or shared-secret");
});

test("migrations: replay create, alter, index, drop in file order", () => {
  const schema = parseMigrations([
    { file: "0002.sql", text: "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS name TEXT;\nCREATE INDEX IF NOT EXISTS rooms_by_name ON rooms (name);\nDROP TABLE IF EXISTS old_thing;" },
    {
      file: "0001.sql",
      text: "-- rooms\nCREATE TABLE IF NOT EXISTS rooms (\n  id TEXT PRIMARY KEY,\n  payload JSONB NOT NULL,\n  CHECK (id <> '')\n);\nCREATE TABLE old_thing (a INT, b INT, PRIMARY KEY (a, b));"
    }
  ]);
  assert.deepEqual(schema.tables.map((t) => t.name), ["rooms"]);
  const rooms = schema.tables[0];
  assert.deepEqual(rooms.columns.map((c) => c.name), ["id", "payload", "name"]);
  assert.equal(rooms.primaryKey, "id");
  assert.deepEqual(rooms.indexes, ["rooms_by_name"]);
  assert.deepEqual(rooms.alteredIn, ["0002.sql"]);
  assert.deepEqual(schema.dropped, ["old_thing"]);
});

test("imports, env reads, swift types, markers, timers", () => {
  assert.deepEqual(parseImports('import { a } from "./a.js";\nexport * from "../b.js";\nimport "./side.js";\nawait import("./lazy.js");'), [
    "./a.js",
    "../b.js",
    "./side.js",
    "./lazy.js"
  ]);
  assert.deepEqual(parseEnvReads('process.env.PORT; process.env["HOST"]; const { DATABASE_URL, X: y = 1 } = process.env;'), [
    "DATABASE_URL",
    "HOST",
    "PORT",
    "X"
  ]);
  assert.deepEqual(parseSwiftTypes("public struct A {}\n@MainActor final class B {}\n  struct Nested {}\nenum C {}"), ["A", "B", "C"]);
  assert.deepEqual(countMarkers("// TODO: a\n// FIXME(x)\n// todo lower"), { TODO: 1, FIXME: 1, HACK: 0, total: 2 });
  assert.deepEqual(findTimers("x\nsetInterval(fn, 1000)"), [{ kind: "setInterval", line: 2 }]);
});
