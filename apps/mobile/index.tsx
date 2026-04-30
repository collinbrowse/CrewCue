import type { ReactElement } from "react";
import { registerRootComponent } from "expo";
import { LogBox } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import App from "./App";

const KEEP_AWAKE_ACTIVITY_ERROR = "ExpoKeepAwake.activate";
const ACTIVITY_UNAVAILABLE_ERROR = "The current activity is no longer available";

LogBox.ignoreLogs([KEEP_AWAKE_ACTIVITY_ERROR]);

function isTransientKeepAwakeActivityError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value ?? "");
  return message.includes(KEEP_AWAKE_ACTIVITY_ERROR) && message.includes(ACTIVITY_UNAVAILABLE_ERROR);
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("unhandledrejection", (event: any) => {
    if (!isTransientKeepAwakeActivityError(event?.reason)) {
      return;
    }
    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }
  });
}

function Root(): ReactElement {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}

registerRootComponent(Root);
