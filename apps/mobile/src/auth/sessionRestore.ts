import type { StoredTokens } from "./tokenStorage";

export function shouldRestoreStoredSession(
  stored: StoredTokens | undefined,
  nowMs: number = Date.now()
): stored is StoredTokens {
  if (!stored?.accessToken) {
    return false;
  }

  if (typeof stored.expiresAtMs !== "number") {
    return true;
  }

  return stored.expiresAtMs > nowMs;
}
