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
    return TurboModuleRegistry.get("MLRNCameraModule") != null;
  } catch {
    return false;
  }
}
