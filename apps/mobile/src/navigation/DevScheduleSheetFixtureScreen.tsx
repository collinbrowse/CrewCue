import { useCallback, useMemo, useState, type ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ManualCheckpointStopInput, StopPlanResponse, UpsertStopPlanInput } from "../api/client";
import { useDSTheme } from "../design-system";
import { CrewScheduleSheetView } from "../features/schedule/CrewScheduleSheetView";
import {
  applyDevClosedCheckIn,
  applyDevStopPlanUpsert,
  DEV_SCHEDULE_CHECKPOINT_TITLES,
  loadDevScheduleFixtureSheet,
  overlayToStopPlanResponse,
  projectDevSheetWithOverlays,
  seedDevStopPlanOverlays,
  type DevStopPlanOverlay
} from "../features/schedule/devScheduleFixture";
import { mapManualStopWriteError, mapStopPlanWriteError } from "../features/schedule/scheduleErrors";

/**
 * __DEV__-only guest screen: schedule sheet with in-memory stop-plan + check-in for simulator QA.
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
  const [closedActuals, setClosedActuals] = useState<Map<string, number>>(() => new Map());
  const sheet = useMemo(
    () => projectDevSheetWithOverlays(baseSheet, overlays, closedActuals),
    [baseSheet, overlays, closedActuals]
  );

  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const [checkInCheckpointId, setCheckInCheckpointId] = useState<string | null>(null);
  const [savingCheckIn, setSavingCheckIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | undefined>(undefined);

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

  const onSaveCheckIn = useCallback(
    (checkpointId: string, input: ManualCheckpointStopInput) => {
      if (savingCheckIn) {
        return;
      }
      setSavingCheckIn(true);
      setCheckInError(undefined);
      try {
        const actualSeconds = applyDevClosedCheckIn(input);
        setClosedActuals((prev) => {
          const next = new Map(prev);
          next.set(checkpointId, actualSeconds);
          return next;
        });
        setCheckInCheckpointId(null);
      } catch (err) {
        setCheckInError(mapManualStopWriteError(err));
      } finally {
        setSavingCheckIn(false);
      }
    },
    [savingCheckIn]
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
        DEV fixture · editable stop plans + check-in · no Auth0 · fixtures/pacing/schedule-expected.json
      </Text>
      <CrewScheduleSheetView
        sheet={sheet}
        loading={false}
        titleByCheckpointId={titleByCheckpointId}
        canEditStopPlans
        editingCheckpointId={editingCheckpointId}
        onEditStop={(id) => {
          setCheckInCheckpointId(null);
          setCheckInError(undefined);
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
        canEditCheckIn
        checkInCheckpointId={checkInCheckpointId}
        onOpenCheckIn={(id) => {
          setEditingCheckpointId(null);
          setSaveError(undefined);
          setCheckInCheckpointId(id);
          setCheckInError(undefined);
        }}
        onCancelCheckIn={() => {
          setCheckInCheckpointId(null);
          setCheckInError(undefined);
        }}
        savingCheckIn={savingCheckIn}
        checkInError={checkInError}
        onSaveCheckIn={onSaveCheckIn}
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
