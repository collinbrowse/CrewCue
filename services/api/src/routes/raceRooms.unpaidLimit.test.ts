/**
 * The unpaid race limit on `POST /race-rooms`: an account may have created at most 3 races that
 * are still `unpaid`. Runs against the real store (memory here, Postgres in CI's
 * api-postgres-integration job, where the count is the `race_rooms_json` query). Postgres runs
 * share one database, so every account here is fresh.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RaceRoom, UnpaidRaceLimitError } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { UNPAID_RACE_LIMIT } from "../lib/billingEntitlement.js";
import { countUnpaidRaceRoomsCreatedBy, saveRaceRoom, setRaceRoomCreateDelayForTests } from "./raceRooms.js";

type App = ReturnType<typeof buildApp>;

const uid = (name: string) => `${name}-${randomUUID().slice(0, 8)}`;

const LIMIT_MESSAGE = "You have 3 races that aren't unlocked yet. Unlock or delete one to add another.";

function auth(app: App, sub: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} })}` };
}

async function withApp(run: (app: App) => Promise<void>): Promise<void> {
  const app = buildApp();
  await app.ready();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

function create(
  app: App,
  creator: string,
  opts: { athleteId?: string; creatorRole?: string; key?: string; name?: string } = {}
) {
  return app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: opts.athleteId ?? creator,
      name: opts.name ?? "Unpaid limit 50k",
      creatorRole: opts.creatorRole ?? "athlete"
    },
    headers: { ...auth(app, creator), ...(opts.key ? { "idempotency-key": opts.key } : {}) }
  });
}

async function createRace(app: App, creator: string, opts: Parameters<typeof create>[2] = {}): Promise<RaceRoom> {
  const response = await create(app, creator, opts);
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as RaceRoom;
}

async function setEntitlement(app: App, roomId: string, member: string, status: "paid" | "unpaid" | "expired") {
  const response = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status, crewTier: "unlimited" },
    headers: auth(app, member)
  });
  assert.equal(response.statusCode, 200, response.body);
}

function assertLimitReached(response: Awaited<ReturnType<typeof create>>): void {
  assert.equal(response.statusCode, 409, response.body);
  assert.deepEqual(response.json() as UnpaidRaceLimitError, {
    error: LIMIT_MESSAGE,
    code: "unpaid_race_limit",
    limit: 3
  });
}

test("the limit is 3, and the message says so plainly", () => {
  assert.equal(UNPAID_RACE_LIMIT, 3);
});

test("a 4th unpaid race is refused with 409 unpaid_race_limit and nothing is created", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-limit");
    for (let i = 0; i < 3; i += 1) {
      await createRace(app, runner, { name: `Unpaid ${i}` });
    }
    assertLimitReached(await create(app, runner, { name: "Unpaid 3" }));
    assert.equal(await countUnpaidRaceRoomsCreatedBy(runner), 3);
    const mine = await app.inject({ method: "GET", url: "/race-rooms/mine", headers: auth(app, runner) });
    assert.equal(mine.statusCode, 200, mine.body);
    assert.equal((mine.json() as { rooms: RaceRoom[] }).rooms.length, 3);
  });
});

test("paid and expired races don't count; once one race is paid a new create succeeds", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-limit-paid");
    const [first, second] = [await createRace(app, runner), await createRace(app, runner)];
    await createRace(app, runner);
    assertLimitReached(await create(app, runner));

    await setEntitlement(app, first.id, runner, "paid");
    await createRace(app, runner);
    assertLimitReached(await create(app, runner));

    // Paid, then expired: still not unpaid.
    await setEntitlement(app, second.id, runner, "paid");
    await setEntitlement(app, second.id, runner, "expired");
    await createRace(app, runner);
    assertLimitReached(await create(app, runner));
    assert.equal(await countUnpaidRaceRoomsCreatedBy(runner), 3);

    // A refund puts a race back to unpaid, and it counts again.
    await setEntitlement(app, first.id, runner, "unpaid");
    assert.equal(await countUnpaidRaceRoomsCreatedBy(runner), 4);
    assertLimitReached(await create(app, runner));
  });
});

test("races the user only crews don't count, nor races someone else created naming them the runner", async () => {
  await withApp(async (app) => {
    const user = uid("crew-and-runner");
    const otherRunner = uid("other-runner");
    const crewChief = uid("crew-chief");

    // The user crews someone else's race, which is later refunded to unpaid.
    const crewed = await createRace(app, otherRunner);
    await setEntitlement(app, crewed.id, otherRunner, "paid");
    const joined = await app.inject({
      method: "POST",
      url: "/race-rooms/join-by-code",
      payload: { roomCode: crewed.joinCode },
      headers: auth(app, user)
    });
    assert.equal(joined.statusCode, 200, joined.body);
    await setEntitlement(app, crewed.id, otherRunner, "unpaid");

    // A crew chief creates a race naming the user as its runner: it counts against the chief.
    await createRace(app, crewChief, { athleteId: user, creatorRole: "crew_chief" });
    assert.equal(await countUnpaidRaceRoomsCreatedBy(crewChief), 1);
    assert.equal(await countUnpaidRaceRoomsCreatedBy(otherRunner), 1);
    assert.equal(await countUnpaidRaceRoomsCreatedBy(user), 0);

    for (let i = 0; i < 3; i += 1) {
      await createRace(app, user);
    }
    assertLimitReached(await create(app, user));
  });
});

test("a refused create can be retried with the same Idempotency-Key once a race is unlocked", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-limit-key");
    const first = await createRace(app, runner);
    await createRace(app, runner);
    await createRace(app, runner);
    const key = uid("key");
    assertLimitReached(await create(app, runner, { key }));
    // Asked again before anything changed: refused again, not replayed as a success.
    assertLimitReached(await create(app, runner, { key }));

    await setEntitlement(app, first.id, runner, "paid");
    const retried = await create(app, runner, { key });
    assert.equal(retried.statusCode, 201, retried.body);
    const replay = await create(app, runner, { key });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal((replay.json() as RaceRoom).id, (retried.json() as RaceRoom).id);
  });
});

test("a retry of a create that already succeeded answers the room, even at the limit", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-limit-replay");
    const key = uid("key");
    const keyed = await createRace(app, runner, { key });
    await createRace(app, runner);
    await createRace(app, runner);
    const replay = await create(app, runner, { key });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal((replay.json() as RaceRoom).id, keyed.id);
    assertLimitReached(await create(app, runner));
  });
});

test("two creates at once on one instance can't both take the last unpaid slot", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-limit-race");
    await createRace(app, runner);
    await createRace(app, runner);
    // The first create pauses after counting 2 and before saving, so the others count while it waits.
    let paused!: () => void;
    const pausedAfterCount = new Promise<void>((resolve) => {
      paused = resolve;
    });
    setRaceRoomCreateDelayForTests(async () => {
      paused();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const first = create(app, runner);
    await pausedAfterCount;
    const results = await Promise.all([first, create(app, runner), create(app, runner)]);
    setRaceRoomCreateDelayForTests(undefined);
    assert.deepEqual(
      results.map((response) => response.statusCode).sort(),
      [201, 409, 409],
      results.map((response) => response.body).join("\n")
    );
    assert.equal(await countUnpaidRaceRoomsCreatedBy(runner), 3);
  });
});

test("a room stored before #649 (no createdByUserId) counts toward its first member", async () => {
  await withApp(async (app) => {
    const runner = uid("runner-legacy");
    const now = new Date().toISOString();
    for (let i = 0; i < 2; i += 1) {
      await saveRaceRoom({
        id: randomUUID(),
        teamId: "team-1",
        athleteId: runner,
        name: `Legacy ${i}`,
        status: "active",
        createdAt: now,
        entitlement: { status: "unpaid", lastUpdatedAt: now, source: "manual" },
        memberships: [{ userId: runner, role: "athlete", joinedAt: now }]
      });
    }
    assert.equal(await countUnpaidRaceRoomsCreatedBy(runner), 2);
    await createRace(app, runner);
    assertLimitReached(await create(app, runner));
  });
});
