import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { MapLibreNativeMissingScreen } from "../features/maps/MapLibreNativeMissingScreen";
import { isMapLibreNativeAvailable } from "../features/maps/maplibreNativeGate";

export function NavigateScreen(): ReactElement {
  if (Platform.OS === "web") {
    return (
      <View style={styles.box}>
        <Text style={styles.text}>Turn-by-turn navigation runs on the CrewCue iOS/Android app.</Text>
      </View>
    );
  }
  if (!isMapLibreNativeAvailable()) {
    return <MapLibreNativeMissingScreen />;
  }
  const { NavigateScreenNative } =
    require("./NavigateScreen.native") as typeof import("./NavigateScreen.native");
  return <NavigateScreenNative />;
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 24, justifyContent: "center", backgroundColor: "#f3efe6" },
  text: { color: "#111827", textAlign: "center" }
});
