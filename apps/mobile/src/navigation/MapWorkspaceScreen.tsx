import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { MapLibreNativeMissingScreen } from "../features/maps/MapLibreNativeMissingScreen";
import { isMapLibreNativeAvailable } from "../features/maps/maplibreNativeGate";

export function MapWorkspaceScreen(): ReactElement {
  if (Platform.OS === "web") {
    return (
      <View style={styles.box}>
        <Text style={styles.text}>Use the CrewCue iOS/Android app for the interactive map workspace.</Text>
      </View>
    );
  }
  if (!isMapLibreNativeAvailable()) {
    return <MapLibreNativeMissingScreen />;
  }
  // Avoid static import: loading MapWorkspaceScreen.native pulls MapLibre and crashes Expo Go / unmigrated binaries.
  const { MapWorkspaceScreenNative } =
    require("./MapWorkspaceScreen.native") as typeof import("./MapWorkspaceScreen.native");
  return <MapWorkspaceScreenNative />;
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 24, justifyContent: "center", backgroundColor: "#0f172a" },
  text: { color: "#e2e8f0", textAlign: "center" }
});
