import type { BasemapPresetId } from "../../preferences/basemapPreference";
import Constants from "expo-constants";

function maptilerApiKey(): string | null {
  const envKey = process.env.EXPO_PUBLIC_MAPTILER_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }
  const extraKey =
    (
      Constants.expoConfig?.extra as
        | { maptilerApiKey?: string | null }
        | undefined
    )?.maptilerApiKey?.trim() ?? "";
  return extraKey || null;
}

function maptilerStyle(preset: BasemapPresetId): string | null {
  const key = maptilerApiKey();
  if (!key) {
    return null;
  }
  // v4 styles currently emit unsupported style-spec properties in MapLibre RN/native.
  // Keep mobile on the compatible slugs to avoid ParseStyle warnings when toggling.
  const slug =
    preset === "outdoor" ? "outdoor-v2" : preset === "streets" ? "streets-v2" : "satellite";
  return `https://api.maptiler.com/maps/${slug}/style.json?key=${encodeURIComponent(key)}`;
}

const DEMO_STYLE = "https://demotiles.maplibre.org/style.json";

/** Resolve basemap style URL for MapLibre RN from persisted preset id. */
export function mobileMapStyleUrlForPreset(preset: BasemapPresetId): string {
  return maptilerStyle(preset) ?? DEMO_STYLE;
}

/** Style id token for offline/analytics correlation */
export function basemapStyleAnalyticsId(preset: BasemapPresetId): string {
  const key = maptilerApiKey();
  if (!key) {
    return "maplibre_demo";
  }
  return `maptiler_${preset}`;
}
