/**
 * Runtime configuration for the mobile app.
 *
 * Values come from Expo's `EXPO_PUBLIC_*` env convention. At build time Expo
 * inlines them into the JS bundle, so never put real secrets here.
 *
 * Create `apps/mobile/.env` (see `.env.example`) with:
 *   EXPO_PUBLIC_AUTH0_DOMAIN=dev-xxxx.us.auth0.com
 *   EXPO_PUBLIC_AUTH0_CLIENT_ID=...
 *   EXPO_PUBLIC_AUTH0_AUDIENCE=https://crewcue-staging-api
 *   EXPO_PUBLIC_API_BASE_URL=https://your-api.up.railway.app
 */

type MobileConfig = {
  auth0Domain: string;
  auth0ClientId: string;
  auth0Audience: string;
  apiBaseUrl: string;
};

type MobileConfigResult =
  | { ok: true; config: MobileConfig }
  | { ok: false; missing: string[] };

function readEnv(key: string): string | undefined {
  const v = process.env[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export function loadMobileConfig(): MobileConfigResult {
  const auth0Domain = readEnv("EXPO_PUBLIC_AUTH0_DOMAIN");
  const auth0ClientId = readEnv("EXPO_PUBLIC_AUTH0_CLIENT_ID");
  const auth0Audience = readEnv("EXPO_PUBLIC_AUTH0_AUDIENCE");
  const apiBaseUrl = readEnv("EXPO_PUBLIC_API_BASE_URL");

  const missing: string[] = [];
  if (!auth0Domain) missing.push("EXPO_PUBLIC_AUTH0_DOMAIN");
  if (!auth0ClientId) missing.push("EXPO_PUBLIC_AUTH0_CLIENT_ID");
  if (!auth0Audience) missing.push("EXPO_PUBLIC_AUTH0_AUDIENCE");
  if (!apiBaseUrl) missing.push("EXPO_PUBLIC_API_BASE_URL");

  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    config: {
      auth0Domain: auth0Domain!,
      auth0ClientId: auth0ClientId!,
      auth0Audience: auth0Audience!,
      apiBaseUrl: apiBaseUrl!.replace(/\/$/, "")
    }
  };
}
