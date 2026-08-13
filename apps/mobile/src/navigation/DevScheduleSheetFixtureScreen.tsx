import type { ReactElement } from "react";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDSTheme } from "../design-system";
import { CrewScheduleSheetView } from "../features/schedule/CrewScheduleSheetView";
import {
  DEV_SCHEDULE_CHECKPOINT_TITLES,
  loadDevScheduleFixtureSheet
} from "../features/schedule/devScheduleFixture";

/**
 * __DEV__-only guest screen: mounts the read-only schedule sheet with pacing fixture data.
 * Entry: `crewcue://dev/schedule-sheet`. Not an Auth0/session bypass.
 */
export function DevScheduleSheetFixtureScreen(): ReactElement {
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
  const sheet = useMemo(() => loadDevScheduleFixtureSheet(), []);
  const titleByCheckpointId = useMemo(() => new Map(DEV_SCHEDULE_CHECKPOINT_TITLES), []);

  if (typeof __DEV__ === "undefined" || !__DEV__) {
    return (
      <View style={[styles.blocked, { backgroundColor: theme.color.background, paddingTop: insets.top }]}>
        <Text style={{ color: theme.color.body }}>Schedule fixture is only available in development builds.</Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.background, paddingTop: insets.top }]}
      accessibilityLabel="Dev schedule fixture"
    >
      <Text style={[styles.banner, { color: theme.color.body }]} accessibilityLabel="Dev schedule fixture banner">
        DEV fixture · no Auth0 · fixtures/pacing/schedule-expected.json
      </Text>
      <CrewScheduleSheetView sheet={sheet} loading={false} titleByCheckpointId={titleByCheckpointId} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  blocked: { flex: 1, padding: 16, justifyContent: "center" },
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: "600"
  }
});
