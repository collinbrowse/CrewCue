import assert from "node:assert/strict";
import test from "node:test";
import { courseHistoryAttribution } from "../attribution.js";
import {
  fetchOpenSplitTimeEvents,
  openSplitTimeEventFromSpreadHtml,
  openSplitTimeSpreadUrl,
  parseElapsed,
  parseStartTime
} from "./openSplitTime.js";

// A hand-made page with the structure of an OST elapsed-style spread (made-up runners).
function page(rows: string[][], statuses: string[] = rows.map(() => "Finished")): string {
  const th = (name: string, mile: string, inOut = true) =>
    `<th class="text-nowrap text-center">\n  ${name}<br>${inOut ? "In / Out<br>" : ""}(Mile ${mile})\n</th>`;
  const tr = (cells: string[], i: number) =>
    `<tr id="effort_${i}" data-x="1">
      <td>${i}/${i}</td><td>${100 + i}</td><td><strong><a href="/efforts/x">Runner ${i}</a></strong></td>
      <td>Female, 30</td><td>Somewhere</td><td class="text-nowrap">${statuses[i]}</td>
      ${cells.map((c) => `<td class="text-nowrap text-center"><span>${c}</span></td>`).join("\n")}
    </tr>`;
  return `<html><head><title>OpenSplitTime: Full results - Test 50K 2025</title></head><body>
    <div class="ost-subtitle">
      <p>Saturday, June 7, 2025  6:30AM (MDT)
        on <a href="/organizations/x/courses/test-50k">Test 50K</a></p>
    </div>
    <table><thead><tr><th>Status</th>${th("Aid One", "10.0")}${th("Aid &amp; Two", "20.5")}${th("Finish", "31.0", false)}</tr></thead>
    <tbody>${rows.map(tr).join("\n")}</tbody></table></body></html>`;
}

test("parses times and start (zone abbreviation → UTC)", () => {
  assert.equal(parseElapsed("02:16"), 8160);
  assert.equal(parseElapsed("35:12:09"), 35 * 3600 + 12 * 60 + 9);
  assert.equal(parseElapsed("--"), null);
  assert.equal(parseStartTime("Saturday, June 7, 2025 6:30AM (MDT)"), "2025-06-07T12:30:00.000Z");
  assert.equal(parseStartTime("Friday, Sep 1, 2025 12:00PM (PST)"), null, "short month names are not guessed");
  assert.equal(parseStartTime("Friday, September 1, 2025 12:00PM (CEST)"), null, "unknown zone is rejected");
  assert.equal(parseStartTime("Friday, September 1, 2025 12:00AM (PDT)"), "2025-09-01T07:00:00.000Z");
});

test("spread page → split format: start added, miles → meters, in/out kept, finishers only", () => {
  const event = openSplitTimeEventFromSpreadHtml(
    page(
      [
        ["01:30 / 01:35", "03:10 / 03:10", "05:02:30"],
        ["01:40 / 01:41", "--", "06:00:00"],
        ["01:50 / 01:52", "03:40 / 03:44", "06:30:00"],
        ["02:00 / 02:01", "04:00 / 04:02", "07:00:00"]
      ],
      ["Finished", "Finished", "Finished", "Dropped"]
    ),
    "test-50k-2025"
  );
  assert.equal(event.source, "opensplittime");
  assert.equal(event.name, "Test 50K 2025");
  assert.equal(event.startTime, "2025-06-07T12:30:00.000Z");
  assert.deepEqual(event.checkpoints.map((c) => [c.name, c.distanceMeters]), [
    ["Start", 0],
    ["Aid One", 16093],
    ["Aid & Two", 32992],
    ["Finish", 49890]
  ]);
  assert.equal(event.efforts.length, 2, "missing split and non-finisher dropped");
  assert.deepEqual(event.efforts[0]!.splits[0], { checkpointId: event.checkpoints[1]!.id, inSeconds: 5400, outSeconds: 5700 });
  assert.deepEqual(event.efforts[0]!.splits[1], { checkpointId: event.checkpoints[2]!.id, inSeconds: 11400 }, "equal in/out = no stop");
  assert.equal(event.efforts[0]!.splits[2]!.inSeconds, 5 * 3600 + 2 * 60 + 30);
  assert.ok(!JSON.stringify(event).includes("Runner"), "no names");
});

test("names come out as plain text: entities decode once, leftover angle brackets are dropped", () => {
  const html = page([["01:30 / 01:35", "03:10 / 03:10", "05:02:30"]]).replace("Aid One", "Aid &amp;lt;b&amp;gt; &lt;script&gt;x");
  const name = openSplitTimeEventFromSpreadHtml(html, "x").checkpoints[1]!.name;
  assert.equal(name, "Aid &lt;b&gt; scriptx");
});

test("a page without a start time or mileage is rejected", () => {
  assert.throws(() => openSplitTimeEventFromSpreadHtml(page([]).replace("(MDT)", "(XYZ)"), "x"), /start time/);
  assert.throws(() => openSplitTimeEventFromSpreadHtml(page([]).replace("(Mile 10.0)", ""), "x"), /mileage/);
});

test("fetch is one request per slug against the elapsed spread page, and bad slugs never reach the network", async () => {
  const urls: string[] = [];
  const fake = (async (url: string) => {
    urls.push(url);
    return new Response(page([["01:30 / 01:35", "03:10 / 03:10", "05:02:30"]]), { status: 200 });
  }) as unknown as typeof fetch;
  const events = await fetchOpenSplitTimeEvents(["a-2024", "a-2025"], fake, 0);
  assert.equal(events.length, 2);
  assert.deepEqual(urls, [openSplitTimeSpreadUrl("a-2024"), openSplitTimeSpreadUrl("a-2025")]);
  assert.match(urls[0]!, /^https:\/\/www\.opensplittime\.org\/events\/a-2024\/spread\?display_style=elapsed/);
  await assert.rejects(fetchOpenSplitTimeEvents(["../admin"], fake, 0), /slug/);
  assert.equal(urls.length, 2);
});

test("attribution credits OpenSplitTime only when its events are used", () => {
  assert.equal(courseHistoryAttribution(["opensplittime:a", "opensplittime:b", "crewcue:r1"]), " (results from OpenSplitTime.org)");
  assert.equal(courseHistoryAttribution(["crewcue:r1", "file:x"]), "");
});
