import test from "node:test";
import assert from "node:assert/strict";
import { mercatorTilePixelForLngLat } from "./mercatorTileMath";

test("mercatorTilePixelForLngLat: origin at center of zoom-0 tile", () => {
  const r = mercatorTilePixelForLngLat(0, 0, 0);
  assert.equal(r.tileX, 0);
  assert.equal(r.tileY, 0);
  assert.ok(Math.abs(r.ox256 - 128) < 1e-6);
  assert.ok(Math.abs(r.oy256 - 128) < 1e-6);
});

test("mercatorTilePixelForLngLat: SF sample lies inside one tile at z11", () => {
  const r = mercatorTilePixelForLngLat(-122.4194, 37.7749, 11);
  assert.ok(r.ox256 >= 0 && r.ox256 < 256);
  assert.ok(r.oy256 >= 0 && r.oy256 < 256);
  assert.equal(r.tileX, 327);
  assert.equal(r.tileY, 791);
});
