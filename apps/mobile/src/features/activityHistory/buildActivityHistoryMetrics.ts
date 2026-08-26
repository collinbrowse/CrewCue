/**
 * Async GPX fingerprint + metrics packaging (expo-crypto; keep out of node unit tests).
 */
import * as Crypto from "expo-crypto";
import {
  parseActivityGpxMetrics,
  type ActivityHistoryMetricsIngest
} from "./uploadActivityGpx";

/** Stable fingerprint for idempotent uploads (matches API: sha256 hex, first 32 chars). */
export async function fingerprintGpxExternalId(gpxXml: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, gpxXml);
  return digest.slice(0, 32);
}

/** Parse + fingerprint for `POST /activity-history`. */
export async function buildActivityHistoryMetricsIngest(
  gpxXml: string
): Promise<ActivityHistoryMetricsIngest> {
  const trimmed = gpxXml.replace(/^\uFEFF/, "").trim();
  const metrics = parseActivityGpxMetrics(trimmed);
  return {
    ...metrics,
    externalId: await fingerprintGpxExternalId(trimmed)
  };
}
