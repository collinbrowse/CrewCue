import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform, TurboModuleRegistry } from "react-native";

/** True when MapLibre native code is linked (development/production build — not Expo Go). */
export function isMapLibreNativeAvailable(): boolean {
  if (Platform.OS === "web") return false;
  // Expo Go never ships MapLibre; TurboModule lookups alone are unreliable before the bridge is ready.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return false;
  }
  try {
    if (TurboModuleRegistry.get("MLRNCameraModule") == null) {
      return false;
    }
    // Some emulator/dev-client combinations can pass TurboModule presence checks
    // but still fail when the package initializes. Probe the package directly.
    const mod = require("@maplibre/maplibre-react-native") as { Camera?: unknown; Map?: unknown };
    return Boolean(mod.Camera && mod.Map);
  } catch {
    return false;
  }
}
