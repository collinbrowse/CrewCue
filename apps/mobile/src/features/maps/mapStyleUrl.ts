import type { BasemapPresetId } from "../../preferences/basemapPreference";
import Constants from "expo-constants";
import { mercatorTilePixelForLngLat } from "./mercatorTileMath";

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

export { mercatorTilePixelForLngLat } from "./mercatorTileMath";

export type BasemapPreviewLayout = {
  uri: string;
  /** Pixel offset of map center inside the loaded bitmap (256 or 512 wide). */
  oxPx: number;
  oyPx: number;
  /** Loaded image width/height (256 or 512 for @2x). */
  intrinsicSize: number;
};

/**
 * MapTiler raster tile + pixel anchor so the preview can be **cropped around the map center** (not the tile center).
 * Static maps API is paid-only; tiles use the same key as the live map.
 */
export function basemapPreviewLayout(
  preset: BasemapPresetId,
  lon: number,
  lat: number,
  zoom: number,
  pixelRatio: number = 1
): BasemapPreviewLayout | null {
  const key = maptilerApiKey();
  if (!key) {
    return null;
  }
  const safeLon = Number.isFinite(lon) ? lon : -98.5795;
  const safeLat = Number.isFinite(lat) ? lat : 39.8283;
  const safeZoom = Number.isFinite(zoom) ? zoom : 11;
  const z = Math.min(22, Math.max(0, Math.round(safeZoom)));
  const slug =
    preset === "outdoor" ? "outdoor-v2" : preset === "streets" ? "streets-v2" : "satellite";
  const { tileX, tileY, ox256, oy256 } = mercatorTilePixelForLngLat(safeLon, safeLat, z);
  const useRetina = pixelRatio >= 2;
  const scale = useRetina ? "@2x" : "";
  const intrinsicSize = useRetina ? 512 : 256;
  const oxPx = ox256 * (intrinsicSize / 256);
  const oyPx = oy256 * (intrinsicSize / 256);
  const uri = `https://api.maptiler.com/maps/${slug}/256/${z}/${tileX}/${tileY}${scale}.png?key=${encodeURIComponent(key)}`;
  return { uri, oxPx, oyPx, intrinsicSize };
}

/** @deprecated Prefer basemapPreviewLayout + anchored Image; kept for call sites that only need the URL string. */
export function basemapPreviewUri(
  preset: BasemapPresetId,
  lon: number,
  lat: number,
  zoom: number,
  pixelRatio: number = 1
): string | null {
  return basemapPreviewLayout(preset, lon, lat, zoom, pixelRatio)?.uri ?? null;
}

/** Style id token for offline/analytics correlation */
export function basemapStyleAnalyticsId(preset: BasemapPresetId): string {
  const key = maptilerApiKey();
  if (!key) {
    return "maplibre_demo";
  }
  return `maptiler_${preset}`;
}
