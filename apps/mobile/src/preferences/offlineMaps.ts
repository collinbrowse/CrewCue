import * as SecureStore from "expo-secure-store";

const OFFLINE_MAPS_KEY = "crewcue.offline_maps_unlocked";

/** Placeholder entitlement until subscription SKU wiring exists. */
export async function getOfflineMapsUnlocked(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(OFFLINE_MAPS_KEY);
  return raw === "true";
}

export async function setOfflineMapsUnlocked(unlocked: boolean): Promise<void> {
  await SecureStore.setItemAsync(OFFLINE_MAPS_KEY, unlocked ? "true" : "false");
}
