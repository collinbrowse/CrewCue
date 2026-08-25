import { useCallback, useMemo, useState, type ReactElement } from "react";
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
import { checkpointDisplayTitle } from "../features/pace/timeline";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { CrewScheduleSheet } from "@crewcue/contracts";
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

  /** Cold-start CTA → Profile Connect Strava (W3-2). */
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
    />
  );
}
