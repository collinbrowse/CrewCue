const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const appJson = require("./app.json");

function resolveMaptilerApiKey() {
  const envKey = process.env.EXPO_PUBLIC_MAPTILER_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) {
    return undefined;
  }

  try {
    const parsed = parseEnv(readFileSync(envPath, "utf8"));
    const fileKey = parsed.EXPO_PUBLIC_MAPTILER_API_KEY?.trim();
    if (fileKey) {
      process.env.EXPO_PUBLIC_MAPTILER_API_KEY = fileKey;
      return fileKey;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

module.exports = ({ config }) => {
  const maptilerApiKey = resolveMaptilerApiKey();
  const baseExpo = appJson.expo ?? {};

  return {
    ...baseExpo,
    ...config,
    extra: {
      ...(baseExpo.extra ?? {}),
      ...(config?.extra ?? {}),
      ...(maptilerApiKey ? { maptilerApiKey } : {})
    }
  };
};
