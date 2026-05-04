import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { MapWorkspaceScreenNative } from "./MapWorkspaceScreen.native";

export function MapWorkspaceScreen(): ReactElement {
  if (Platform.OS === "web") {
    return (
      <View style={styles.box}>
        <Text style={styles.text}>Use the CrewCue iOS/Android app for the interactive map workspace.</Text>
      </View>
    );
  }
  return <MapWorkspaceScreenNative />;
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 24, justifyContent: "center", backgroundColor: "#0f172a" },
  text: { color: "#e2e8f0", textAlign: "center" }
});
