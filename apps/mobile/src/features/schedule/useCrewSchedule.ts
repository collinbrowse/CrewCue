import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import {
  createApiClient,
  type ManualCheckpointStopInput,
  type StopPlanResponse,
  type UpsertStopPlanInput
} from "../../api/client";
import {
  canEditCheckpointStopsFromRoomRole,
  canEditRaceCourseFromRoomRole
} from "../../auth/roleGuards";
import { checkpointDisplayTitle } from "../pace/timeline";
import { mapPacingEstimateError } from "./pacingEstimateErrors";
import {
  mapManualStopWriteError,
  mapScheduleFetchError,
  mapStopPlanWriteError
} from "./scheduleErrors";
import {
  EMPTY_ESTIMATE_HISTORY_RECORD,
  decideEstimateRecompute,
  usableActivityHistory,
  usableHistoryFingerprint,
  type EstimateHistoryRecord
} from "./estimateRecompute";
import { useAuthedShell } from "../../shell/AuthedShellContext";
import type { CrewScheduleSheet, PacingEstimate } from "@crewcue/contracts";
import type { CrewMainTabParamList } from "../../navigation/types";

export type UseCrewScheduleResult = {
  sheet: CrewScheduleSheet | null;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  titleByCheckpointId: Map<string, string>;
  hasRoom: boolean;
  load: (mode: "initial" | "refresh") => Promise<void>;
  canEditStopPlans: boolean;
  editingCheckpointId: string | null;
  onEditStop: (checkpointId: string) => void;
  onCancelEdit: () => void;
  editingPlan: StopPlanResponse | null;
  loadingPlan: boolean;
  savingPlan: boolean;
  saveError?: string;
  actionError?: string;
  onSaveStopPlan: (checkpointId: string, input: UpsertStopPlanInput) => void;
  onClearStopDelay: (checkpointId: string) => void;
  onClearAthleteNotes: (checkpointId: string) => void;
  onClearPlanNotes: (checkpointId: string) => void;
  onClearStopPlan: (checkpointId: string) => void;
  canEditCheckIn: boolean;
  checkInCheckpointId: string | null;
  onOpenCheckIn: (checkpointId: string) => void;
  onCancelCheckIn: () => void;
  savingCheckIn: boolean;
  checkInError?: string;
  onSaveCheckIn: (checkpointId: string, input: ManualCheckpointStopInput) => void;
  pacingEstimate: PacingEstimate | null;
  addingHistory: boolean;
  onAddHistory: () => void;
  estimateError?: string;
  onRecalculateFromHistory?: () => void;
  recalculating: boolean;
  dismissEditors: () => void;
  editorOpen: boolean;
};

export type UseCrewScheduleOptions = {
  /** When the athlete's live-next checkpoint changes, refetch clocks (not on every projection poll). */
  liveNextCheckpointId?: string | null;
};

export function useCrewSchedule(options?: UseCrewScheduleOptions): UseCrewScheduleResult {
  const s = useAuthedShell();
  const navigation = useNavigation<BottomTabNavigationProp<CrewMainTabParamList>>();
  const room = s.room;
  const titleByCheckpointId = useMemo(() => {
    const map = new Map<string, string>();
    for (const cp of room?.course?.checkpoints ?? []) {
      map.set(cp.id, checkpointDisplayTitle(cp));
    }
    return map;
  }, [room?.course?.checkpoints]);

  const canEditStopPlans =
    (s.roomDetail?.permissions?.canEditRaceSetup ?? canEditRaceCourseFromRoomRole(s.currentRoomRole)) === true;

  const canEditCheckIn =
    (s.roomDetail?.permissions?.canEditCheckpointStops ?? canEditCheckpointStopsFromRoomRole(s.currentRoomRole)) ===
    true;

  const [sheet, setSheet] = useState<CrewScheduleSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<StopPlanResponse | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const [checkInCheckpointId, setCheckInCheckpointId] = useState<string | null>(null);
  const [savingCheckIn, setSavingCheckIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | undefined>(undefined);

  const [createdEstimate, setCreatedEstimate] = useState<PacingEstimate | null>(null);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [estimateError, setEstimateError] = useState<string | undefined>(undefined);
  const autoEstimateRoomRef = useRef<string | null>(null);
  const [historySignature, setHistorySignature] = useState<
    { fingerprint: string; usableCount: number } | undefined
  >(undefined);
  const estimateHistoryRecordRef = useRef<EstimateHistoryRecord>(EMPTY_ESTIMATE_HISTORY_RECORD);
  const liveNextSeenRef = useRef<string | null | undefined>(undefined);

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

  useEffect(() => {
    const liveId = options?.liveNextCheckpointId;
    if (liveNextSeenRef.current === undefined) {
      liveNextSeenRef.current = liveId;
      return;
    }
    if (liveNextSeenRef.current !== liveId) {
      liveNextSeenRef.current = liveId;
      void load("refresh");
    }
  }, [options?.liveNextCheckpointId, load]);

  const refetchAfterWrite = useCallback(async () => {
    if (!room?.id || !client) {
      return;
    }
    const next = await client.getSchedule(room.id);
    setSheet(next);
  }, [room?.id, client]);

  const applyRaceRoomFromServer = s.onApplyRaceRoomFromServer;
  const fetchProjection = s.onFetchProjection;

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

  useEffect(() => {
    setCreatedEstimate(null);
    setEstimateError(undefined);
    setHistorySignature(undefined);
    estimateHistoryRecordRef.current = EMPTY_ESTIMATE_HISTORY_RECORD;
    autoEstimateRoomRef.current = null;
    liveNextSeenRef.current = undefined;
    setEditingCheckpointId(null);
    setEditingPlan(null);
    setCheckInCheckpointId(null);
    setSaveError(undefined);
    setCheckInError(undefined);
    setActionError(undefined);
  }, [room?.id]);

  useEffect(() => {
    if (!room?.id || autoEstimateRoomRef.current === room.id) {
      return;
    }
    if (sheet && !sheet.pacingEstimateId && canEditStopPlans && !createdEstimate && !estimateBusy) {
      autoEstimateRoomRef.current = room.id;
      void runEstimate(false);
    }
  }, [room?.id, sheet, canEditStopPlans, createdEstimate, estimateBusy, runEstimate]);

  useEffect(() => {
    const active = createdEstimate ?? room?.pacingEstimate ?? null;
    const decision = decideEstimateRecompute({
      canEdit: canEditStopPlans,
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
  }, [canEditStopPlans, estimateBusy, createdEstimate, room?.pacingEstimate, historySignature, runEstimate]);

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
        try {
          await refetchAfterWrite();
          setEditingCheckpointId(null);
          setEditingPlan(null);
        } catch (refetchErr) {
          setEditingCheckpointId(null);
          setEditingPlan(null);
          setActionError(`${mapScheduleFetchError(refetchErr)} Pull to refresh to update schedule clocks.`);
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
          setActionError(`${mapScheduleFetchError(refetchErr)} Pull to refresh to update schedule clocks.`);
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
      void runWrite(checkpointId, () => client.patchStopPlan(room.id, checkpointId, { delayOverrideSeconds: null }));
    },
    [client, room?.id, runWrite]
  );

  const onClearAthleteNotes = useCallback(
    (checkpointId: string) => {
      if (!client || !room?.id) {
        return;
      }
      void runWrite(checkpointId, () => client.patchStopPlan(room.id, checkpointId, { athleteNotes: null }));
    },
    [client, room?.id, runWrite]
  );

  const onClearPlanNotes = useCallback(
    (checkpointId: string) => {
      if (!client || !room?.id) {
        return;
      }
      void runWrite(checkpointId, () => client.patchStopPlan(room.id, checkpointId, { planNotes: null }));
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

  const onAddHistory = useCallback(() => {
    navigation.navigate("Profile", { screen: "ProfileHome" });
  }, [navigation]);

  const onCancelEdit = useCallback(() => {
    setEditingCheckpointId(null);
    setEditingPlan(null);
    setSaveError(undefined);
    setActionError(undefined);
  }, []);

  const onCancelCheckIn = useCallback(() => {
    setCheckInCheckpointId(null);
    setCheckInError(undefined);
  }, []);

  const dismissEditors = useCallback(() => {
    setEditingCheckpointId(null);
    setEditingPlan(null);
    setSaveError(undefined);
    setCheckInCheckpointId(null);
    setCheckInError(undefined);
  }, []);

  return {
    sheet,
    loading,
    refreshing,
    error,
    titleByCheckpointId,
    hasRoom: Boolean(room),
    load,
    canEditStopPlans,
    editingCheckpointId,
    onEditStop: (id) => {
      void onEditStop(id);
    },
    onCancelEdit,
    editingPlan,
    loadingPlan,
    savingPlan,
    saveError,
    actionError,
    onSaveStopPlan,
    onClearStopDelay,
    onClearAthleteNotes,
    onClearPlanNotes,
    onClearStopPlan,
    canEditCheckIn,
    checkInCheckpointId,
    onOpenCheckIn,
    onCancelCheckIn,
    savingCheckIn,
    checkInError,
    onSaveCheckIn: (id, input) => {
      void onSaveCheckIn(id, input);
    },
    pacingEstimate,
    addingHistory: estimateBusy,
    onAddHistory,
    estimateError,
    onRecalculateFromHistory: canEditStopPlans ? onRecalculateFromHistory : undefined,
    recalculating: estimateBusy,
    dismissEditors,
    editorOpen: editingCheckpointId != null || checkInCheckpointId != null
  };
}
