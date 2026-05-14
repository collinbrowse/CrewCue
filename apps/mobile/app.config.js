const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const appJson = require("./app.json");

function loadExpoPublicEnvFromFile() {
  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  try {
    const parsed = parseEnv(readFileSync(envPath, "utf8"));
    for (const [key, rawValue] of Object.entries(parsed)) {
      if (!key.startsWith("EXPO_PUBLIC_")) {
        continue;
      }
      const value = String(rawValue ?? "").trim();
      if (!value) {
        continue;
      }
      process.env[key] = value;
    }
  } catch {
    return;
  }
}

function resolveMaptilerApiKey() {
  const envKey = process.env.EXPO_PUBLIC_MAPTILER_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }
  return undefined;
}

module.exports = ({ config }) => {
  loadExpoPublicEnvFromFile();
  const maptilerApiKey = resolveMaptilerApiKey();
  const baseExpo = appJson.expo ?? {};

  const merged = {
    ...baseExpo,
    ...config,
    extra: {
      ...(baseExpo.extra ?? {}),
      ...(config?.extra ?? {}),
      ...(maptilerApiKey ? { maptilerApiKey } : {})
    }
  };

  // Expo merges can override app.json. SDK 55 + RN 0.83 ship the new architecture in
  // native Gradle; keep this flag true so Metro/native agree (avoids missing Fabric
  // views such as RNCSafeAreaProvider at runtime).
  merged.newArchEnabled = true;

  return merged;
};
