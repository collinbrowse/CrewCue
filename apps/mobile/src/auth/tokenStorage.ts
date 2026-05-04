import * as SecureStore from "../storage/secureStorage";

const ACCESS_TOKEN_KEY = "crewcue.auth0.accessToken";
const REFRESH_TOKEN_KEY = "crewcue.auth0.refreshToken";
const ID_TOKEN_KEY = "crewcue.auth0.idToken";
const EXPIRES_AT_KEY = "crewcue.auth0.expiresAtMs";

export type StoredTokens = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAtMs?: number;
};

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken);
  if (tokens.refreshToken) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
  }
  if (tokens.idToken) {
    await SecureStore.setItemAsync(ID_TOKEN_KEY, tokens.idToken);
  }
  if (typeof tokens.expiresAtMs === "number") {
    await SecureStore.setItemAsync(EXPIRES_AT_KEY, String(tokens.expiresAtMs));
  }
}

export async function loadTokens(): Promise<StoredTokens | undefined> {
  const accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  if (!accessToken) {
    return undefined;
  }
  const refreshToken = (await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)) ?? undefined;
  const idToken = (await SecureStore.getItemAsync(ID_TOKEN_KEY)) ?? undefined;
  const expiresRaw = await SecureStore.getItemAsync(EXPIRES_AT_KEY);
  const expiresAtMs = expiresRaw ? Number(expiresRaw) : undefined;
  const result: StoredTokens = { accessToken };
  if (refreshToken) result.refreshToken = refreshToken;
  if (idToken) result.idToken = idToken;
  if (typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs)) {
    result.expiresAtMs = expiresAtMs;
  }
  return result;
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  await SecureStore.deleteItemAsync(ID_TOKEN_KEY);
  await SecureStore.deleteItemAsync(EXPIRES_AT_KEY);
}
