import { canonicalJsonStringify } from "@crewcue/platform-client";

async function sha256Hex(json: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const bytes = new TextEncoder().encode(json);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  const Crypto = require("expo-crypto") as {
    digestStringAsync: (algorithm: string, data: string) => Promise<string>;
    CryptoDigestAlgorithm: { SHA256: string };
  };
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, json);
}

/** Stable short hash for idempotency keys derived from request bodies. */
export async function hashIdempotencyPayload(payload: unknown): Promise<string> {
  const json = canonicalJsonStringify(payload);
  return (await sha256Hex(json)).slice(0, 16);
}
