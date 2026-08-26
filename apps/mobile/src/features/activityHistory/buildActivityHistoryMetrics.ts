/**
 * Async GPX fingerprint + metrics packaging (expo-crypto; keep out of node unit tests).
 */
import * as Crypto from "expo-crypto";
import {
  parseActivityGpxMetricsAsync,
  type ActivityHistoryMetricsIngest
} from "./uploadActivityGpx";

/** Stable fingerprint for idempotent uploads (matches API: sha256 hex, first 32 chars). */
export async function fingerprintGpxExternalId(gpxXml: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, gpxXml);
  return digest.slice(0, 32);
}

/**
 * Parse + fingerprint for `POST /activity-history`.
 * `onProgress` is 0..1 across parse (0–0.9) then fingerprint (0.9–1).
 */
export async function buildActivityHistoryMetricsIngest(
  gpxXml: string,
  onProgress?: (ratio: number) => void | Promise<void>
): Promise<ActivityHistoryMetricsIngest> {
  const trimmed = gpxXml.replace(/^\uFEFF/, "").trim();
  const metrics = await parseActivityGpxMetricsAsync(trimmed, async (parseRatio) => {
    await onProgress?.(parseRatio * 0.9);
  });
  await onProgress?.(0.92);
  const externalId = await fingerprintGpxExternalId(trimmed);
  await onProgress?.(1);
  return {
    ...metrics,
    externalId
  };
}
