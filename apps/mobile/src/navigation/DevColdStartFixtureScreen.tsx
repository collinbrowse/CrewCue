/**
 * __DEV__-only guest screen: cold-start estimate UX for simulator QA.
 * Entry: `crewcue://dev/cold-start`. Not an Auth0/session bypass.
 *
 * Starts with `coldStart: true` coarse estimate + prompt; "Simulate history arrived"
 * swaps to the history-backed golden fixture so the prompt dismisses (EC5).
 */
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PacingEstimate } from "@crewcue/contracts";
import { ApiError } from "../api/client";
import { useDSTheme } from "../design-system";
import { CrewScheduleSheetView } from "../features/schedule/CrewScheduleSheetView";
import {
  loadDevColdStartFixture,
  loadDevHistoryBackedFixture,
  shouldShowColdStartPrompt
} from "../features/schedule/devColdStartFixture";
import { DEV_SCHEDULE_CHECKPOINT_TITLES } from "../features/schedule/devScheduleFixture";
import { mapPacingEstimateError } from "../features/schedule/pacingEstimateErrors";

export function DevColdStartFixtureScreen(): ReactElement {
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
  const coldPack = useMemo(() => loadDevColdStartFixture(), []);
  const historyPack = useMemo(() => loadDevHistoryBackedFixture(), []);
  const titleByCheckpointId = useMemo(() => new Map(DEV_SCHEDULE_CHECKPOINT_TITLES), []);

  const [estimate, setEstimate] = useState<PacingEstimate>(coldPack.estimate);
  const [sheet, setSheet] = useState(coldPack.sheet);
  const [addingHistory, setAddingHistory] = useState(false);
  const [estimateError, setEstimateError] = useState<string | undefined>(undefined);
  const [ctaHint, setCtaHint] = useState<string | undefined>(undefined);

  const onAddHistory = useCallback(() => {
    if (addingHistory) {
      return;
    }
    setAddingHistory(true);
    setEstimateError(undefined);
    setCtaHint(undefined);
    // DEV: brief busy state so sim can assert EC8 (CTA disabled / busy).
    setTimeout(() => {
      setAddingHistory(false);
      setCtaHint("Connect Strava from Profile when signed in. DEV: use Simulate history arrived for EC5.");
    }, 600);
  }, [addingHistory]);

  const onSimulateHistoryArrived = useCallback(() => {
    setEstimate(historyPack.estimate);
    setSheet(historyPack.sheet);
    setEstimateError(undefined);
    setCtaHint(undefined);
    setAddingHistory(false);
  }, [historyPack]);

  const onSimulateEstimate400 = useCallback(() => {
    setEstimateError(
      mapPacingEstimateError(new ApiError(400, { error: "course_incomplete: distances missing" }))
    );
  }, []);

  const onSimulateOffline = useCallback(() => {
    setEstimateError(mapPacingEstimateError(new Error("Failed to fetch — network offline")));
  }, []);

  if (typeof __DEV__ === "undefined" || !__DEV__) {
    return (
      <View style={[styles.blocked, { backgroundColor: theme.color.background, paddingTop: insets.top }]}>
        <Text style={{ color: theme.color.body }}>Cold-start fixture is only available in development builds.</Text>
      </View>
    );
  }

  const showColdStart = shouldShowColdStartPrompt(estimate);

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.background, paddingTop: insets.top }]}
      accessibilityLabel="Dev cold start fixture"
    >
      <Text style={[styles.banner, { color: theme.color.body }]} accessibilityLabel="Dev cold start fixture banner">
        DEV fixture · cold-start estimate · no Auth0 · fixtures/pacing/estimate-cold-start.json
      </Text>
      <View style={styles.devBar}>
        {showColdStart ? (
          <View style={styles.devActions}>
            <Pressable
              onPress={onSimulateHistoryArrived}
              accessibilityRole="button"
              accessibilityLabel="Simulate history arrived"
              style={[styles.devBtn, { backgroundColor: theme.color.secondaryButton }]}
            >
              <Text style={[styles.devBtnLabel, { color: theme.color.text }]}>Simulate history arrived</Text>
            </Pressable>
            <Pressable
              onPress={onSimulateEstimate400}
              accessibilityRole="button"
              accessibilityLabel="Simulate estimate error"
              style={[styles.devBtn, { backgroundColor: theme.color.secondaryButton }]}
            >
              <Text style={[styles.devBtnLabel, { color: theme.color.text }]}>Simulate 400</Text>
            </Pressable>
            <Pressable
              onPress={onSimulateOffline}
              accessibilityRole="button"
              accessibilityLabel="Simulate offline estimate"
              style={[styles.devBtn, { backgroundColor: theme.color.secondaryButton }]}
            >
              <Text style={[styles.devBtnLabel, { color: theme.color.text }]}>Simulate offline</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={[styles.refreshed, { color: theme.color.body }]} accessibilityLabel="History backed estimate">
            History-backed estimate · cold-start prompt dismissed
          </Text>
        )}
        {ctaHint ? (
          <Text style={[styles.hint, { color: theme.color.body }]} accessibilityLabel="Cold start add history hint">
            {ctaHint}
          </Text>
        ) : null}
      </View>
      <CrewScheduleSheetView
        sheet={sheet}
        loading={false}
        titleByCheckpointId={titleByCheckpointId}
        pacingEstimate={estimate}
        addingHistory={addingHistory}
        onAddHistory={onAddHistory}
        estimateError={estimateError}
      />
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
  },
  devBar: {
    paddingHorizontal: 16,
    paddingBottom: 4
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8
  },
  refreshed: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8
  },
  devActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8
  },
  devBtn: {
    borderRadius: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: "center"
  },
  devBtnLabel: {
    fontWeight: "700",
    fontSize: 13
  }
});
