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

export type BuildActivityHistoryMetricsOptions = {
  /** When set (after a duplicate check), skip hashing again. */
  externalId?: string;
  /** 0..1 across parse (and fingerprint when externalId is not precomputed). */
  onProgress?: (ratio: number) => void | Promise<void>;
};

/**
 * Parse (+ fingerprint unless provided) for `POST /activity-history`.
 */
export async function buildActivityHistoryMetricsIngest(
  gpxXml: string,
  options?: BuildActivityHistoryMetricsOptions
): Promise<ActivityHistoryMetricsIngest> {
  const trimmed = gpxXml.replace(/^\uFEFF/, "").trim();
  const onProgress = options?.onProgress;
  const precomputedId = options?.externalId?.trim();

  if (precomputedId) {
    const metrics = await parseActivityGpxMetricsAsync(trimmed, onProgress);
    return { ...metrics, externalId: precomputedId };
  }

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
