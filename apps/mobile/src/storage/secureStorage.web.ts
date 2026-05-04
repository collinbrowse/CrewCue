/**
 * Web build: never import `expo-secure-store` (native bridge methods are absent → runtime TypeError).
 */
const WEB_PREFIX = "__crewcue_secure:";

function webGet(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(WEB_PREFIX + key);
  } catch {
    return null;
  }
}

function webSet(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(WEB_PREFIX + key, value);
  } catch {
    /* private mode / quota */
  }
}

function webDelete(key: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(WEB_PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** @param _options ignored on web */
export async function getItemAsync(key: string, _options?: unknown): Promise<string | null> {
  return webGet(key);
}

export async function setItemAsync(key: string, value: string, _options?: unknown): Promise<void> {
  webSet(key, value);
}

export async function deleteItemAsync(key: string, _options?: unknown): Promise<void> {
  webDelete(key);
}
