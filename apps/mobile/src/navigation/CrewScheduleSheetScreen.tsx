import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { createApiClient } from "../api/client";
import { CrewScheduleSheetView } from "../features/schedule/CrewScheduleSheetView";
import { mapScheduleFetchError } from "../features/schedule/scheduleErrors";
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

  const [sheet, setSheet] = useState<CrewScheduleSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!room?.id || !s.auth.accessToken) {
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
        const client = createApiClient({ baseUrl: s.baseUrl, accessToken: s.auth.accessToken });
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
    [room?.id, s.auth.accessToken, s.baseUrl]
  );

  useFocusEffect(
    useCallback(() => {
      void load("initial");
    }, [load])
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
    />
  );
}
