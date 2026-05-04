import type { BasemapPresetId } from "../../preferences/basemapPreference";

function maptilerStyle(preset: Exclude<BasemapPresetId, "demo">): string | null {
  const key = process.env.EXPO_PUBLIC_MAPTILER_API_KEY?.trim();
  if (!key) {
    return null;
  }
  const slug =
    preset === "outdoor" ? "outdoor-v2" : preset === "streets" ? "streets-v2" : "satellite";
  return `https://api.maptiler.com/maps/${slug}/style.json?key=${encodeURIComponent(key)}`;
}

const DEMO_STYLE = "https://demotiles.maplibre.org/style.json";

/** Resolve basemap style URL for MapLibre RN from persisted preset id. */
export function mobileMapStyleUrlForPreset(preset: BasemapPresetId): string {
  if (preset === "demo") {
    return DEMO_STYLE;
  }
  return maptilerStyle(preset) ?? DEMO_STYLE;
}

/** Style id token for offline/analytics correlation */
export function basemapStyleAnalyticsId(preset: BasemapPresetId): string {
  const key = process.env.EXPO_PUBLIC_MAPTILER_API_KEY?.trim();
  if (!key) {
    return "maplibre_demo";
  }
  return preset === "demo" ? "maplibre_demo" : `maptiler_${preset}`;
}
