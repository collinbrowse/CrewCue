import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  createApiClient,
  type ManualCheckpointStopInput,
  type StopPlanResponse,
  type UpsertStopPlanInput
} from "../api/client";
import {
  canEditCheckpointStopsFromRoomRole,
  canEditRaceCourseFromRoomRole
} from "../auth/roleGuards";
import { CrewScheduleSheetView } from "../features/schedule/CrewScheduleSheetView";
import {
  mapManualStopWriteError,
  mapScheduleFetchError,
  mapStopPlanWriteError
} from "../features/schedule/scheduleErrors";
import { mapPacingEstimateError } from "../features/schedule/pacingEstimateErrors";
import {
  EMPTY_ESTIMATE_HISTORY_RECORD,
  decideEstimateRecompute,
  shouldAutoCreateEstimate,
  usableActivityHistory,
  usableHistoryFingerprint,
  viewerIsRaceAthlete,
  type EstimateHistoryRecord
} from "../features/schedule/estimateRecompute";
import { checkpointDisplayTitle } from "../features/pace/timeline";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { CrewScheduleSheet, PacingEstimate } from "@crewcue/contracts";
import type { CrewMainTabParamList, ReadoutsStackParamList } from "./types";

type ScheduleNav = CompositeNavigationProp<
  NativeStackNavigationProp<ReadoutsStackParamList, "ScheduleSheet">,
  BottomTabNavigationProp<CrewMainTabParamList>
>;

export function CrewScheduleSheetScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<ScheduleNav>();
  const room = s.room;
  const titleByCheckpointId = useMemo(() => {
    const map = new Map<string, string>();
    for (const cp of room?.course?.checkpoints ?? []) {
      map.set(cp.id, checkpointDisplayTitle(cp));
    }
    return map;
  }, [room?.course?.checkpoints]);

  const canEditStopPlans =
    (s.roomDetail?.permissions?.canEditRaceSetup ?? canEditRaceCourseFromRoomRole(s.currentRoomRole)) ===
    true;

  const canEditCheckIn =
    (s.roomDetail?.permissions?.canEditCheckpointStops ??
      canEditCheckpointStopsFromRoomRole(s.currentRoomRole)) === true;

  const isRaceAthlete = viewerIsRaceAthlete({
    viewerUserId: s.auth.claims?.sub,
    memberships: room?.memberships,
    currentRoomRole: s.currentRoomRole
  });

  const [sheet, setSheet] = useState<CrewScheduleSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<StopPlanResponse | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  /** Sheet-level action errors when the inline editor is closed (failed plan load / post-save refetch). */
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const [checkInCheckpointId, setCheckInCheckpointId] = useState<string | null>(null);
  const [savingCheckIn, setSavingCheckIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | undefined>(undefined);

  /** Freshly generated estimate (shown before the shared room refreshes). */
  const [createdEstimate, setCreatedEstimate] = useState<PacingEstimate | null>(null);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [estimateError, setEstimateError] = useState<string | undefined>(undefined);
  /** Auto-generate the estimate at most once per room per mount (avoids retry loops on failure). */
  const autoEstimateRoomRef = useRef<string | null>(null);
  /** Usable-history signature (fingerprint + count) so we recompute when history changes (#487). */
  const [historySignature, setHistorySignature] = useState<
    { fingerprint: string; usableCount: number } | undefined
  >(undefined);
  /** Fingerprint recorded for the currently observed estimate (auto-recompute loop guard). */
  const estimateHistoryRecordRef = useRef<EstimateHistoryRecord>(EMPTY_ESTIMATE_HISTORY_RECORD);

  const client = useMemo(() => {
    if (!s.auth.accessToken) {
      return null;
    }
    return createApiClient({ baseUrl: s.baseUrl, accessToken: s.auth.accessToken });
  }, [s.auth.accessToken, s.baseUrl]);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!room?.id || !client) {
        setSheet(null);
        setError(undefined);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(undefined);
      setActionError(undefined);
      try {
        const next = await client.getSchedule(room.id);
        setSheet(next);
      } catch (err) {
        setSheet(null);
        setError(mapScheduleFetchError(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
      // Load a usable-history signature so we can recompute the estimate when the athlete's history
      // changes (#487). Non-fatal: without it we simply fall back to manual "Recalculate".
      try {
        const listed = await client.listActivityHistory();
        setHistorySignature({
          fingerprint: usableHistoryFingerprint(listed.items),
          usableCount: usableActivityHistory(listed.items).length
        });
      } catch {
        // Ignore — history signature is best-effort and must not block the schedule.
      }
    },
    [room?.id, client]
  );

  useFocusEffect(
    useCallback(() => {
      void load("initial");
    }, [load])
  );

  const refetchAfterWrite = useCallback(async () => {
    if (!room?.id || !client) {
      return;
    }
    const next = await client.getSchedule(room.id);
    setSheet(next);
  }, [room?.id, client]);

  const applyRaceRoomFromServer = s.onApplyRaceRoomFromServer;
  const fetchProjection = s.onFetchProjection;

  /**
   * Connect uploaded history to the plan (PR A): create the micro-model estimate, attach it
   * **by id** (so the stored baseline reaches `course.baselineTrack` and the server re-derives
   * `plannedPaceSecondsPerKm`), then refresh the shared room + projection + schedule so map,
   * Pace, and schedule clocks agree. Auto-runs once when no estimate is attached; `force` powers
   * the explicit "Recalculate from my history" action. Only course editors may attach.
   */
  const runEstimate = useCallback(
    async (force: boolean) => {
      if (!room?.id || !client || !canEditStopPlans || estimateBusy) {
        return;
      }
      if (!force && (room.pacingEstimateId || createdEstimate)) {
        return;
      }
      setEstimateBusy(true);
      setEstimateError(undefined);
      try {
        const estimate = await client.createPacingEstimate(room.id);
        await client.attachPacingEstimate(room.id, estimate.id);
        setCreatedEstimate(estimate);
        // Refresh the shared room (new estimate + baseline + plannedPace) and projection so the
        // map and Pace screens agree with the schedule, then refetch schedule clocks.
        try {
          const refreshed = await client.getRaceRoom(room.id);
          applyRaceRoomFromServer(refreshed.room);
        } catch {
          // Non-fatal: the estimate is attached; shared room refresh can catch up on next focus.
        }
        fetchProjection();
        await refetchAfterWrite();
      } catch (err) {
        setEstimateError(mapPacingEstimateError(err));
      } finally {
        setEstimateBusy(false);
      }
    },
    [
      room?.id,
      room?.pacingEstimateId,
      client,
      canEditStopPlans,
      estimateBusy,
      createdEstimate,
      applyRaceRoomFromServer,
      fetchProjection,
      refetchAfterWrite
    ]
  );

  const onRecalculateFromHistory = useCallback(() => {
    void runEstimate(true);
  }, [runEstimate]);

  // Reset local estimate state when switching rooms.
  useEffect(() => {
    setCreatedEstimate(null);
    setEstimateError(undefined);
    setHistorySignature(undefined);
    estimateHistoryRecordRef.current = EMPTY_ESTIMATE_HISTORY_RECORD;
  }, [room?.id]);

  // Auto-generate a plan-of-record estimate once when the loaded schedule has none, so a racer
  // never sees a silent 6:00/km fallback (no history yields the cold-start estimate + prompt).
  // Non-athletes may only seed a universal cold-start; their personal history must not attach.
  useEffect(() => {
    if (!room?.id || autoEstimateRoomRef.current === room.id) {
      return;
    }
    if (
      sheet &&
      shouldAutoCreateEstimate({
        isRaceAthlete,
        canEdit: canEditStopPlans,
        hasAttachedEstimate: Boolean(sheet.pacingEstimateId || createdEstimate),
        busy: estimateBusy,
        usableHistoryCount: historySignature?.usableCount
      })
    ) {
      autoEstimateRoomRef.current = room.id;
      void runEstimate(false);
    }
  }, [
    room?.id,
    sheet,
    canEditStopPlans,
    createdEstimate,
    estimateBusy,
    isRaceAthlete,
    historySignature?.usableCount,
    runEstimate
  ]);

  // Recompute + re-attach when the attached estimate is stale for the *athlete's* current history:
  // a cold-start estimate that locked in before an upload, or new/changed history this session
  // (#487). Loop-safe via the recorded fingerprint. Crew chiefs / managers do not auto-recompute.
  useEffect(() => {
    const active = createdEstimate ?? room?.pacingEstimate ?? null;
    const decision = decideEstimateRecompute({
      canEdit: canEditStopPlans,
      allowHistoryRecompute: isRaceAthlete,
      busy: estimateBusy,
      estimateId: active?.id,
      coldStart: active?.coldStart,
      usableHistoryCount: historySignature?.usableCount ?? 0,
      historyFingerprint: historySignature?.fingerprint,
      record: estimateHistoryRecordRef.current
    });
    estimateHistoryRecordRef.current = decision.nextRecord;
    if (decision.recompute) {
      void runEstimate(true);
    }
  }, [
    canEditStopPlans,
    isRaceAthlete,
    estimateBusy,
    createdEstimate,
    room?.pacingEstimate,
    historySignature,
    runEstimate
  ]);

  const pacingEstimate: PacingEstimate | null = createdEstimate ?? room?.pacingEstimate ?? null;

  const onEditStop = useCallback(
    async (checkpointId: string) => {
      if (!canEditStopPlans || !room?.id || !client) {
        return;
      }
      setCheckInCheckpointId(null);
      setCheckInError(undefined);
      setEditingCheckpointId(checkpointId);
      setSaveError(undefined);
      setActionError(undefined);
      setLoadingPlan(true);
      setEditingPlan(null);
      try {
        const plan = await client.getStopPlan(room.id, checkpointId);
        setEditingPlan(plan);
      } catch (err) {
        // Do not open an empty editor on load failure — that can overwrite existing notes.
        setEditingCheckpointId(null);
        setEditingPlan(null);
        setActionError(mapStopPlanWriteError(err));
      } finally {
        setLoadingPlan(false);
      }
    },
    [canEditStopPlans, room?.id, client]
  );

  const onOpenCheckIn = useCallback(
    (checkpointId: string) => {
      if (!canEditCheckIn) {
        return;
      }
      setEditingCheckpointId(null);
      setEditingPlan(null);
      setSaveError(undefined);
      setCheckInCheckpointId(checkpointId);
      setCheckInError(undefined);
      setActionError(undefined);
    },
    [canEditCheckIn]
  );

  const runWrite = useCallback(
    async (checkpointId: string, write: () => Promise<unknown>) => {
      if (!canEditStopPlans || !room?.id || !client || savingPlan) {
        return;
      }
      setSavingPlan(true);
      setSaveError(undefined);
      setActionError(undefined);
      try {
        await write();
        // Close editor only after write succeeds; keep overlay/sheet on write failure (EC2).
        try {
          await refetchAfterWrite();
          setEditingCheckpointId(null);
          setEditingPlan(null);
        } catch (refetchErr) {
          // Persist succeeded; clocks may be stale until pull-to-refresh.
          setEditingCheckpointId(null);
          setEditingPlan(null);
          setActionError(
            `${mapScheduleFetchError(refetchErr)} Pull to refresh to update schedule clocks.`
          );
        }
      } catch (err) {
        setSaveError(mapStopPlanWriteError(err));
      } finally {
        setSavingPlan(false);
      }
    },
    [canEditStopPlans, room?.id, client, savingPlan, refetchAfterWrite]
  );

  const onSaveCheckIn = useCallback(
    async (checkpointId: string, input: ManualCheckpointStopInput) => {
      if (!canEditCheckIn || !room?.id || !client || savingCheckIn) {
        return;
      }
      setSavingCheckIn(true);
      setCheckInError(undefined);
      setActionError(undefined);
      try {
        await client.postManualCheckpointStop(room.id, checkpointId, input);
        try {
          await refetchAfterWrite();
          setCheckInCheckpointId(null);
        } catch (refetchErr) {
          setCheckInCheckpointId(null);
          setActionError(
            `${mapScheduleFetchError(refetchErr)} Pull to refresh to update schedule clocks.`
          );
        }
      } catch (err) {
        setCheckInError(mapManualStopWriteError(err));
      } finally {
        setSavingCheckIn(false);
      }
    },
    [canEditCheckIn, room?.id, client, savingCheckIn, refetchAfterWrite]
  );

  const onSaveStopPlan = useCallback(
    (checkpointId: string, input: UpsertStopPlanInput) => {
      if (!client || !room?.id) {
        return;
      }
      void runWrite(checkpointId, () => client.patchStopPlan(room.id, checkpointId, input));
    },
    [client, room?.id, runWrite]
  );

  const onClearStopDelay = useCallback(
    (checkpointId: string) => {
      if (!client || !room?.id) {
        return;
      }
      void runWrite(checkpointId, () =>
        client.patchStopPlan(room.id, checkpointId, { delayOverrideSeconds: null })
      );
    },
    [client, room?.id, runWrite]
  );

  const onClearAthleteNotes = useCallback(
    (checkpointId: string) => {
      if (!client || !room?.id) {
        return;
      }
      void runWrite(checkpointId, () =>
        client.patchStopPlan(room.id, checkpointId, { athleteNotes: null })
      );
    },
    [client, room?.id, runWrite]
  );

  const onClearPlanNotes = useCallback(
    (checkpointId: string) => {
      if (!client || !room?.id) {
        return;
      }
      void runWrite(checkpointId, () =>
        client.patchStopPlan(room.id, checkpointId, { planNotes: null })
      );
    },
    [client, room?.id, runWrite]
  );

  const onClearStopPlan = useCallback(
    (checkpointId: string) => {
      if (!client || !room?.id) {
        return;
      }
      void runWrite(checkpointId, () => client.clearStopPlan(room.id, checkpointId));
    },
    [client, room?.id, runWrite]
  );

  /** Cold-start CTA → Profile (upload GPX or Connect Strava). */
  const onAddHistory = useCallback(() => {
    navigation.navigate("Profile", { screen: "ProfileHome" });
  }, [navigation]);

  if (!room) {
    return (
      <CrewScheduleSheetView
        sheet={null}
        loading={false}
        emptyRoomMessage="Select a race room to view the crew schedule."
      />
    );
  }

  return (
    <CrewScheduleSheetView
      sheet={sheet}
      loading={loading}
      refreshing={refreshing}
      error={error}
      titleByCheckpointId={titleByCheckpointId}
      onRetry={() => void load("initial")}
      onRefresh={() => void load("refresh")}
      canEditStopPlans={canEditStopPlans}
      editingCheckpointId={editingCheckpointId}
      onEditStop={(id) => void onEditStop(id)}
      onCancelEdit={() => {
        setEditingCheckpointId(null);
        setEditingPlan(null);
        setSaveError(undefined);
        setActionError(undefined);
      }}
      editingPlan={editingPlan}
      loadingPlan={loadingPlan}
      savingPlan={savingPlan}
      saveError={saveError}
      actionError={actionError}
      onSaveStopPlan={onSaveStopPlan}
      onClearStopDelay={onClearStopDelay}
      onClearAthleteNotes={onClearAthleteNotes}
      onClearPlanNotes={onClearPlanNotes}
      onClearStopPlan={onClearStopPlan}
      canEditCheckIn={canEditCheckIn}
      checkInCheckpointId={checkInCheckpointId}
      onOpenCheckIn={onOpenCheckIn}
      onCancelCheckIn={() => {
        setCheckInCheckpointId(null);
        setCheckInError(undefined);
      }}
      savingCheckIn={savingCheckIn}
      checkInError={checkInError}
      onSaveCheckIn={(id, input) => void onSaveCheckIn(id, input)}
      onAddHistory={onAddHistory}
      pacingEstimate={pacingEstimate}
      addingHistory={estimateBusy}
      estimateError={estimateError}
      onRecalculateFromHistory={canEditStopPlans ? onRecalculateFromHistory : undefined}
      recalculating={estimateBusy}
    />
  );
}
