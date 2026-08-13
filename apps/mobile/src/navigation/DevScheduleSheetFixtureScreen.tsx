import { useCallback, useMemo, useState, type ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { StopPlanResponse, UpsertStopPlanInput } from "../api/client";
import { useDSTheme } from "../design-system";
import { CrewScheduleSheetView } from "../features/schedule/CrewScheduleSheetView";
import {
  applyDevStopPlanUpsert,
  DEV_SCHEDULE_CHECKPOINT_TITLES,
  loadDevScheduleFixtureSheet,
  overlayToStopPlanResponse,
  projectDevSheetWithOverlays,
  seedDevStopPlanOverlays,
  type DevStopPlanOverlay
} from "../features/schedule/devScheduleFixture";
import { mapStopPlanWriteError } from "../features/schedule/scheduleErrors";

/**
 * __DEV__-only guest screen: schedule sheet with in-memory stop-plan edit for simulator QA.
 * Entry: `crewcue://dev/schedule-sheet`. Not an Auth0/session bypass.
 * Saves update the displayed sheet (including later clocks) without calling production APIs.
 */
export function DevScheduleSheetFixtureScreen(): ReactElement {
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
  const baseSheet = useMemo(() => loadDevScheduleFixtureSheet(), []);
  const titleByCheckpointId = useMemo(() => new Map(DEV_SCHEDULE_CHECKPOINT_TITLES), []);

  const [overlays, setOverlays] = useState<Map<string, DevStopPlanOverlay>>(() =>
    seedDevStopPlanOverlays(baseSheet)
  );
  const sheet = useMemo(() => projectDevSheetWithOverlays(baseSheet, overlays), [baseSheet, overlays]);

  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const editingPlan: StopPlanResponse | null = useMemo(() => {
    if (!editingCheckpointId) {
      return null;
    }
    return overlayToStopPlanResponse(
      baseSheet.roomId,
      editingCheckpointId,
      overlays.get(editingCheckpointId)
    );
  }, [editingCheckpointId, overlays, baseSheet.roomId]);

  const commitOverlay = useCallback(
    (checkpointId: string, next: DevStopPlanOverlay | undefined) => {
      setOverlays((prev) => {
        const map = new Map(prev);
        // Authoritative entry even when empty so clear does not fall back to base delay.
        map.set(checkpointId, next ?? {});
        return map;
      });
      setEditingCheckpointId(null);
      setSaveError(undefined);
    },
    []
  );

  const runDevWrite = useCallback(
    (checkpointId: string, apply: () => DevStopPlanOverlay | undefined) => {
      if (savingPlan) {
        return;
      }
      setSavingPlan(true);
      setSaveError(undefined);
      try {
        const next = apply();
        commitOverlay(checkpointId, next);
      } catch (err) {
        setSaveError(mapStopPlanWriteError(err));
      } finally {
        setSavingPlan(false);
      }
    },
    [savingPlan, commitOverlay]
  );

  const onSaveStopPlan = useCallback(
    (checkpointId: string, input: UpsertStopPlanInput) => {
      runDevWrite(checkpointId, () =>
        applyDevStopPlanUpsert(overlays.get(checkpointId), checkpointId, input)
      );
    },
    [overlays, runDevWrite]
  );

  const onClearStopDelay = useCallback(
    (checkpointId: string) => {
      runDevWrite(checkpointId, () =>
        applyDevStopPlanUpsert(overlays.get(checkpointId), checkpointId, {
          delayOverrideSeconds: null
        })
      );
    },
    [overlays, runDevWrite]
  );

  const onClearAthleteNotes = useCallback(
    (checkpointId: string) => {
      runDevWrite(checkpointId, () =>
        applyDevStopPlanUpsert(overlays.get(checkpointId), checkpointId, { athleteNotes: null })
      );
    },
    [overlays, runDevWrite]
  );

  const onClearPlanNotes = useCallback(
    (checkpointId: string) => {
      runDevWrite(checkpointId, () =>
        applyDevStopPlanUpsert(overlays.get(checkpointId), checkpointId, { planNotes: null })
      );
    },
    [overlays, runDevWrite]
  );

  const onClearStopPlan = useCallback(
    (checkpointId: string) => {
      runDevWrite(checkpointId, () => undefined);
    },
    [runDevWrite]
  );

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
        DEV fixture · editable stop plans · no Auth0 · fixtures/pacing/schedule-expected.json
      </Text>
      <CrewScheduleSheetView
        sheet={sheet}
        loading={false}
        titleByCheckpointId={titleByCheckpointId}
        canEditStopPlans
        editingCheckpointId={editingCheckpointId}
        onEditStop={(id) => {
          setEditingCheckpointId(id);
          setSaveError(undefined);
        }}
        onCancelEdit={() => {
          setEditingCheckpointId(null);
          setSaveError(undefined);
        }}
        editingPlan={editingPlan}
        loadingPlan={false}
        savingPlan={savingPlan}
        saveError={saveError}
        onSaveStopPlan={onSaveStopPlan}
        onClearStopDelay={onClearStopDelay}
        onClearAthleteNotes={onClearAthleteNotes}
        onClearPlanNotes={onClearPlanNotes}
        onClearStopPlan={onClearStopPlan}
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
  }
});
