/** Recursively sort object keys for stable serialization across clients and API. */
export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key]);
    }
    return sorted;
  }
  return value;
}

/** Stable JSON string for request fingerprints (idempotency hashes, cache keys). */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value ?? null));
}
