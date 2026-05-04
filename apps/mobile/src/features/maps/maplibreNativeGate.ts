import { Platform, TurboModuleRegistry } from "react-native";

/** True when MapLibre native code is linked (development/production build — not Expo Go). */
export function isMapLibreNativeAvailable(): boolean {
  if (Platform.OS === "web") return false;
  return TurboModuleRegistry.get("MLRNCameraModule") != null;
}
