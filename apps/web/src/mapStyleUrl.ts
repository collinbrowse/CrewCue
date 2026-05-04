export function webMapStyleUrl(): string {
  const key = import.meta.env.VITE_MAPTILER_API_KEY?.trim();
  if (key) {
    return `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${encodeURIComponent(key)}`;
  }
  return "https://demotiles.maplibre.org/style.json";
}
