import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { registerRootComponent } from "expo";
import "./src/chat/nativeDependencyPrewarm";
import { ActivityIndicator, LogBox, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

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
  const [AppComponent, setAppComponent] = useState<React.ComponentType<object> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("./App").then((mod) => {
      if (!cancelled) {
        setAppComponent(() => mod.default);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!AppComponent) {
    return (
      <SafeAreaProvider>
        <View style={styles.bootSplash}>
          <ActivityIndicator color="#94a3b8" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AppComponent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  bootSplash: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0f172a"
  }
});

registerRootComponent(Root);
