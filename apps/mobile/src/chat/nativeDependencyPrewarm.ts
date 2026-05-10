/**
 * Eagerly loads chat-related native subgraph at app startup so the first visit
 * to Crew Chat does not trigger separate Metro "Android Bundled …" chunks for
 * SecureStore and expo-notifications entry points (those were deferred via
 * dynamic imports inside chat helpers). Skipped on web export.
 */
import { Platform } from "react-native";

if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../platform/expoNotificationsShim");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../storage/secureStorage");
}
