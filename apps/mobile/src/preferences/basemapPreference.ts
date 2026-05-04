import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "crewcue.basemap_preset";

export type BasemapPresetId = "outdoor" | "streets" | "satellite" | "demo";

export async function getBasemapPreset(): Promise<BasemapPresetId> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === "outdoor" || raw === "streets" || raw === "satellite" || raw === "demo") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return "outdoor";
}

export async function setBasemapPreset(id: BasemapPresetId): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, id);
}
