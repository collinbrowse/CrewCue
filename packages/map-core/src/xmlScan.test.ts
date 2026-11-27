import test from "node:test";
import assert from "node:assert/strict";
import { parseActivityFile } from "./activityFile.js";
import { parseGpxActivityTrack, parseGpxTrack, parseGpxTrackAsync } from "./courseParse.js";
import { firstXmlElement, removeXmlElements, scanXmlElements } from "./xmlScan.js";

/** About `bytes` long: point open tags that never close. */
function unclosedPoints(tag: string, bytes: number): string {
  const unit = `<${tag} lat="37.78" lon="-122.42"><ele>10</ele>`;
  return `<gpx><trk><trkseg>${unit.repeat(Math.ceil(bytes / unit.length))}`;
}

function elapsedMs(run: () => unknown): number {
  const started = performance.now();
  try {
    run();
  } catch {
    // Only the time matters here.
  }
  return performance.now() - started;
}

test("scanXmlElements reads namespaced, mixed-case elements and their attributes", () => {
  const xml = '<a:trkpt lat="1"><ele>2</ele></a:trkpt><TRKPT lat="3"></trkpt><rtept lat="4"></rtept>';
  const found = [...scanXmlElements(xml, "trkpt")].map(({ attributes, body }) => ({ attributes, body }));
  assert.deepEqual(found, [
    { attributes: ' lat="1"', body: "<ele>2</ele>" },
    { attributes: ' lat="3"', body: "" }
  ]);
  assert.equal([...scanXmlElements(xml, "trkpt|rtept")].length, 3);
  assert.equal(firstXmlElement("<metadata><name>N</name></metadata>", "name", { prefix: null })?.body, "N");
});

test("scanXmlElements stops at an open tag with no close tag", () => {
  assert.deepEqual([...scanXmlElements('<trkpt lat="1"></trkpt><trkpt lat="2"><trkpt lat="3">', "trkpt")].length, 1);
  assert.deepEqual([...scanXmlElements('<trkpt lat="1"', "trkpt")], []);
});

test("removeXmlElements cuts each closed element and keeps the rest", () => {
  assert.equal(removeXmlElements("a<link>x</link>b<link>y</link>c<link>z", "link", { prefix: null }), "abc<link>z");
  assert.equal(removeXmlElements("<Lap a>1</Lap><Notes>n</Notes>", "Lap", { openTagEnds: false }), "<Notes>n</Notes>");
  assert.equal(removeXmlElements("plain", "Lap"), "plain");
});

test("a 280 KB file of unclosed point tags parses in linear time", async () => {
  const bytes = 280 * 1024;
  for (const tag of ["trkpt", "rtept", "wpt", "gpxtpx:trkpt"]) {
    const xml = unclosedPoints(tag, bytes);
    assert.ok(elapsedMs(() => parseGpxTrack(xml)) < 200, `parseGpxTrack <${tag}>`);
    assert.ok(elapsedMs(() => parseGpxActivityTrack(xml)) < 200, `parseGpxActivityTrack <${tag}>`);
    assert.ok(elapsedMs(() => parseActivityFile(new TextEncoder().encode(xml), "run.gpx")) < 200, `GPX file <${tag}>`);
    const started = performance.now();
    await parseGpxTrackAsync(xml).catch(() => undefined);
    assert.ok(performance.now() - started < 200, `parseGpxTrackAsync <${tag}>`);
  }
});

test("a 280 KB TCX of unclosed tags parses in linear time", () => {
  const unit = "<Trackpoint><Time>x<Lap <Activity <Track <Notes ";
  const tcx = `<TrainingCenterDatabase><Activity Sport="Running">${unit.repeat(Math.ceil((280 * 1024) / unit.length))}</TrainingCenterDatabase>`;
  assert.ok(elapsedMs(() => parseActivityFile(new TextEncoder().encode(tcx), "run.tcx")) < 200);
});

test("a 280 KB GPX of unclosed name, link and type tags parses in linear time", () => {
  const unit = "<trk <metadata><name><link><type>";
  const xml = `<gpx>${unit.repeat(Math.ceil((280 * 1024) / unit.length))}`;
  assert.ok(elapsedMs(() => parseActivityFile(new TextEncoder().encode(xml), "run.gpx")) < 200);
});
