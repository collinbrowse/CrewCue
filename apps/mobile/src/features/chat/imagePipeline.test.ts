import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_IMAGE_LONG_EDGE_PX,
  CHAT_IMAGE_MAX_BYTES,
  compressForChat
} from "./imagePipeline";

test("imagePipeline: scales long edge down to 1600 when input is large", async () => {
  const calls: Array<{ width: number; height: number; quality: number }> = [];
  const result = await compressForChat({
    uri: "file://input.jpg",
    width: 4000,
    height: 3000,
    fileSize: 10 * 1024 * 1024,
    manipulate: async (_uri, width, height, quality) => {
      calls.push({ width, height, quality });
      return { uri: "file://out.jpg", width, height };
    },
    measure: async () => 1_000_000
  });
  assert.equal(calls[0]?.width, CHAT_IMAGE_LONG_EDGE_PX);
  assert.equal(calls[0]?.height, Math.round((CHAT_IMAGE_LONG_EDGE_PX * 3000) / 4000));
  assert.equal(result.width, CHAT_IMAGE_LONG_EDGE_PX);
});

test("imagePipeline: leaves dimensions unchanged when long edge already small", async () => {
  const calls: Array<{ width: number; height: number; quality: number }> = [];
  await compressForChat({
    uri: "file://small.jpg",
    width: 800,
    height: 600,
    fileSize: 200_000,
    manipulate: async (_u, width, height, quality) => {
      calls.push({ width, height, quality });
      return { uri: "file://out.jpg", width, height };
    },
    measure: async () => 200_000
  });
  assert.equal(calls[0]?.width, 800);
  assert.equal(calls[0]?.height, 600);
});

test("imagePipeline: backs off quality until under 2.5 MB cap", async () => {
  const measurements: number[] = [];
  const sizesByQuality: Record<string, number> = {
    "0.9": 5_000_000,
    "0.8": 4_000_000,
    "0.7": 3_500_000,
    "0.6": 2_400_000,
    "0.5": 1_800_000,
    "0.4": 1_200_000
  };
  let lastQuality = 0.9;
  await compressForChat({
    uri: "file://huge.jpg",
    width: 3000,
    height: 2000,
    fileSize: 5_000_000,
    manipulate: async (_u, _w, _h, quality) => {
      lastQuality = quality;
      return { uri: `file://q-${quality.toFixed(1)}.jpg` };
    },
    measure: async () => {
      const size = sizesByQuality[lastQuality.toFixed(1)] ?? CHAT_IMAGE_MAX_BYTES + 1;
      measurements.push(size);
      return size;
    }
  });
  const final = measurements[measurements.length - 1] ?? Number.POSITIVE_INFINITY;
  assert.ok(final <= CHAT_IMAGE_MAX_BYTES, `final size ${final} should fit cap`);
  assert.ok(measurements.length >= 2, "should have backed off at least once");
});

test("imagePipeline: stops at min quality 0.4 even if still too big", async () => {
  let lastQuality = 0;
  await compressForChat({
    uri: "file://stubborn.jpg",
    width: 4000,
    height: 4000,
    fileSize: 9 * 1024 * 1024,
    manipulate: async (_u, _w, _h, quality) => {
      lastQuality = quality;
      return { uri: `file://q-${quality.toFixed(1)}.jpg` };
    },
    measure: async () => 5 * 1024 * 1024
  });
  assert.ok(lastQuality >= 0.4 - 1e-6, "min quality must be respected");
});
