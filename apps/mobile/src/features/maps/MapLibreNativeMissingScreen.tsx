import type { ReactElement } from "react";
import { Platform, ScrollView, StyleSheet, Text } from "react-native";

/** Shown when JS expects MapLibre but the running native binary does not include it (Expo Go or outdated dev client). */
export function MapLibreNativeMissingScreen(): ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.scroll} style={styles.root}>
      <Text style={styles.title}>Maps require a development build</Text>
      <Text style={styles.body}>
        MapLibre runs only in an iOS/Android binary that includes its native modules. Expo Go does not include them.
      </Text>
      <Text style={styles.body}>
        From the monorepo root, after installing dependencies: run{"\n"}
        <Text style={styles.mono}>cd apps/mobile && npx expo prebuild</Text>
        {"\n"}
        then{"\n"}
        <Text style={styles.mono}>npx expo run:ios</Text> or{" "}
        <Text style={styles.mono}>npx expo run:android</Text>
        {"\n"}
        (or build a dev client with EAS). Rebuild whenever native dependencies like MapLibre change.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  scroll: { padding: 24, paddingBottom: 48 },
  title: { color: "#f8fafc", fontSize: 18, fontWeight: "600", marginBottom: 12 },
  body: { color: "#cbd5e1", fontSize: 15, lineHeight: 22, marginBottom: 14 },
  mono: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), color: "#94a3b8", fontSize: 13 }
});
