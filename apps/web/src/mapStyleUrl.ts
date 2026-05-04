export type WebBasemapPresetId = "outdoor" | "streets" | "satellite" | "demo";

const DEMO_STYLE = "https://demotiles.maplibre.org/style.json";

function maptilerStyle(slug: string): string | null {
  const key = import.meta.env.VITE_MAPTILER_API_KEY?.trim();
  if (!key) {
    return null;
  }
  return `https://api.maptiler.com/maps/${slug}/style.json?key=${encodeURIComponent(key)}`;
}

export function webMapStyleUrlForPreset(preset: WebBasemapPresetId): string {
  if (preset === "demo") {
    return DEMO_STYLE;
  }
  const slug =
    preset === "outdoor" ? "outdoor-v2" : preset === "streets" ? "streets-v2" : "satellite";
  return maptilerStyle(slug) ?? DEMO_STYLE;
}

export function webBasemapAnalyticsId(preset: WebBasemapPresetId): string {
  const key = import.meta.env.VITE_MAPTILER_API_KEY?.trim();
  if (!key) {
    return "maplibre_demo";
  }
  return preset === "demo" ? "maplibre_demo" : `maptiler_${preset}`;
}
