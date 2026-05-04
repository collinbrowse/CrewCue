/** MapLibre style URL: MapTiler outdoor when configured, else MapLibre demo tiles (CI-safe). */
export function mobileMapStyleUrl(): string {
  const key = process.env.EXPO_PUBLIC_MAPTILER_API_KEY?.trim();
  if (key) {
    return `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${encodeURIComponent(key)}`;
  }
  return "https://demotiles.maplibre.org/style.json";
}
