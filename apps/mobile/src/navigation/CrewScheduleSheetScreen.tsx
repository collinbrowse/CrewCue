import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ApiError,
  createApiClient,
  type StopPlanResponse,
  type UpsertStopPlanInput
} from "../api/client";
import { canEditRaceCourseFromRoomRole } from "../auth/roleGuards";
import { CrewScheduleSheetView } from "../features/schedule/CrewScheduleSheetView";
import { mapScheduleFetchError, mapStopPlanWriteError } from "../features/schedule/scheduleErrors";
import { checkpointDisplayTitle } from "../features/pace/timeline";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { CrewScheduleSheet } from "@crewcue/contracts";

export function CrewScheduleSheetScreen(): ReactElement {
  const s = useAuthedShell();
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

  const [sheet, setSheet] = useState<CrewScheduleSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<StopPlanResponse | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

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
      setEditingCheckpointId(checkpointId);
      setSaveError(undefined);
      setLoadingPlan(true);
      setEditingPlan(null);
      try {
        const plan = await client.getStopPlan(room.id, checkpointId);
        setEditingPlan(plan);
      } catch (err) {
        setSaveError(mapStopPlanWriteError(err));
        setEditingPlan({ roomId: room.id, checkpointId });
      } finally {
        setLoadingPlan(false);
      }
    },
    [canEditStopPlans, room?.id, client]
  );

  const runWrite = useCallback(
    async (checkpointId: string, write: () => Promise<unknown>) => {
      if (!canEditStopPlans || !room?.id || !client || savingPlan) {
        return;
      }
      setSavingPlan(true);
      setSaveError(undefined);
      try {
        await write();
        await refetchAfterWrite();
        setEditingCheckpointId(null);
        setEditingPlan(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) {
          setSaveError(mapStopPlanWriteError(err));
        } else {
          setSaveError(mapStopPlanWriteError(err));
        }
        // Overlay / sheet unchanged on failure (EC2).
      } finally {
        setSavingPlan(false);
      }
    },
    [canEditStopPlans, room?.id, client, savingPlan, refetchAfterWrite]
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
      }}
      editingPlan={editingPlan}
      loadingPlan={loadingPlan}
      savingPlan={savingPlan}
      saveError={saveError}
      onSaveStopPlan={onSaveStopPlan}
      onClearStopDelay={onClearStopDelay}
      onClearAthleteNotes={onClearAthleteNotes}
      onClearPlanNotes={onClearPlanNotes}
      onClearStopPlan={onClearStopPlan}
    />
  );
}
