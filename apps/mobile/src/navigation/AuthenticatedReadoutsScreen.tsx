import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { RaceCourseCheckpoint } from "@crewcue/contracts";
import { ScrollView, Text, View } from "react-native";
import { createApiClient } from "../api/client";
import { DSButton, DSCard, DSTextInput } from "../design-system";
import { buildExpectedAidStationSplitsFromCourse } from "../features/gpx/gpxImport";
import { formatEtaClock, formatRemainingMinutes, secondsForDistance } from "../features/readouts/eta";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function AuthenticatedReadoutsScreen(): ReactElement {
  const s = useAuthedShell();
  const room = s.room;
  const paceSecondsPerKm = s.projection?.plannedPaceSecondsPerKm ?? 360;
  const [startTimeInput, setStartTimeInput] = useState("07:00");
  const [draftCheckpoints, setDraftCheckpoints] = useState<RaceCourseCheckpoint[]>(room?.course?.checkpoints ?? []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setDraftCheckpoints(room?.course?.checkpoints ?? []);
  }, [room?.id, room?.course?.checkpoints]);

  const startAnchorMs = useMemo(() => parseStartAnchor(startTimeInput), [startTimeInput]);
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(draftCheckpoints) !== JSON.stringify(room?.course?.checkpoints ?? []),
    [draftCheckpoints, room?.course?.checkpoints]
  );

  const etaRows = useMemo(() => {
    if (startAnchorMs === null || !room?.course) {
      return [];
    }

    const projectionRows = s.projection?.checkpointSplits ?? [];
    const rows =
      projectionRows.length > 0
        ? projectionRows.map((row) => ({ checkpointId: row.checkpointId, distanceMetersFromStart: row.distanceMetersFromStart }))
        : buildExpectedAidStationSplitsFromCourse(room.course, paceSecondsPerKm, "mi").splits.map((split, index) => ({
            checkpointId: room.course?.checkpoints[index]?.id ?? `aid-${index + 1}`,
            distanceMetersFromStart: split.distanceKm * 1000
          }));

    return rows.map((row) => {
      const seconds = secondsForDistance(row.distanceMetersFromStart, paceSecondsPerKm);
      return {
        checkpointId: row.checkpointId,
        etaText: formatEtaClock(startAnchorMs + seconds * 1000),
        elapsedText: formatRemainingMinutes(seconds)
      };
    });
  }, [startAnchorMs, room?.course, s.projection?.checkpointSplits, paceSecondsPerKm]);

  const onSaveCheckpointEdits = async (): Promise<void> => {
    if (!room?.id || !s.auth.accessToken) {
      setSaveError("Sign in again before saving checkpoints.");
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    try {
      const client = createApiClient({ baseUrl: s.baseUrl, accessToken: s.auth.accessToken });
      const updatedRoom = await client.updateRaceCourse(room.id, {
        course: {
          checkpoints: normalizeCheckpointDraft(draftCheckpoints),
          baselineTrack: room.course?.baselineTrack
        },
        plannedPaceSecondsPerKm: paceSecondsPerKm,
        courseDistanceMeters: room.courseDistanceMeters,
        courseElevationGainMeters: room.courseElevationGainMeters,
        courseFileName: room.courseFileName
      });
      s.onApplyRaceRoomFromServer(updatedRoom);
      await s.onFetchRoomDetails(room.id);
      s.onFetchProjection();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save checkpoints.");
    } finally {
      setSaving(false);
    }
  };

  const etaByCheckpointId = useMemo(() => {
    const map = new Map<string, { etaText: string; elapsedText: string }>();
    for (const row of etaRows) {
      map.set(row.checkpointId, { etaText: row.etaText, elapsedText: row.elapsedText });
    }
    return map;
  }, [etaRows]);

  return (
    <ScrollView
      style={s.styles.container}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>Course</Text>
        <Text style={s.styles.subtitle}>Checkpoint order and ETA plan anchored to your race-day start time.</Text>
        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>Start time (local)</Text>
          <DSTextInput value={startTimeInput} onChangeText={setStartTimeInput} placeholder="07:00" />
          <Text style={[s.styles.body, { marginTop: 8 }]}>
            {startAnchorMs === null ? "Enter start as HH:MM (24-hour)." : `Anchored to ${formatEtaClock(startAnchorMs)}.`}
          </Text>
        </DSCard>

        <Text style={[s.styles.summaryTitle, { marginTop: 12 }]}>Checkpoint editor</Text>
        {(draftCheckpoints ?? []).map((checkpoint, index) => (
          <DSCard key={`${checkpoint.id}-${index}`} style={[s.styles.summaryCard, { marginTop: 8 }]}>
            <Text style={s.styles.body}>Checkpoint {index + 1}</Text>
            <DSTextInput
              value={checkpoint.id}
              onChangeText={(next) =>
                setDraftCheckpoints((prev) =>
                  prev.map((row, rowIndex) => (rowIndex === index ? { ...row, id: next } : row))
                )
              }
              placeholder={`Checkpoint ${index + 1}`}
            />
            <Text style={[s.styles.body, { marginTop: 6 }]}>
              {index === 0
                ? "Start checkpoint"
                : (() => {
                const eta = etaByCheckpointId.get(checkpoint.id);
                return eta ? `ETA ${eta.etaText} (${eta.elapsedText} from start)` : "ETA unavailable";
              })()}
            </Text>
            <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <DSButton
                  preset="secondary"
                  onPress={() => setDraftCheckpoints((prev) => moveCheckpoint(prev, index, -1))}
                  disabled={index === 0}
                >
                  Up
                </DSButton>
              </View>
              <View style={{ flex: 1 }}>
                <DSButton
                  preset="secondary"
                  onPress={() => setDraftCheckpoints((prev) => moveCheckpoint(prev, index, 1))}
                  disabled={index === draftCheckpoints.length - 1}
                >
                  Down
                </DSButton>
              </View>
              <View style={{ flex: 1 }}>
                <DSButton preset="secondary" onPress={() => setDraftCheckpoints((prev) => prev.filter((_, i) => i !== index))}>
                  Remove
                </DSButton>
              </View>
            </View>
          </DSCard>
        ))}
        <View style={{ marginTop: 10 }}>
          <DSButton
            preset="secondary"
            onPress={() =>
              setDraftCheckpoints((prev) => [...prev, { id: `aid-${prev.length + 1}`, latitude: 0, longitude: 0, plannedStopSeconds: 120 }])
            }
          >
            Add checkpoint
          </DSButton>
        </View>
        <View style={{ marginTop: 10 }}>
          <DSButton preset="primary" onPress={() => void onSaveCheckpointEdits()} disabled={!hasUnsavedChanges || saving}>
            {saving ? "Saving..." : "Save checkpoint edits"}
          </DSButton>
          {saveError ? <Text style={[s.styles.errorText, { marginTop: 8 }]}>{saveError}</Text> : null}
        </View>
      </DSCard>
    </ScrollView>
  );
}

function parseStartAnchor(input: string): number | null {
  const match = input.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  const now = new Date();
  now.setHours(hour, minute, 0, 0);
  return now.getTime();
}

function moveCheckpoint(checkpoints: RaceCourseCheckpoint[], index: number, delta: -1 | 1): RaceCourseCheckpoint[] {
  const target = index + delta;
  if (target < 0 || target >= checkpoints.length) {
    return checkpoints;
  }
  const copy = [...checkpoints];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item!);
  return copy;
}

function normalizeCheckpointDraft(draft: RaceCourseCheckpoint[]): RaceCourseCheckpoint[] {
  const seen = new Set<string>();
  return draft.map((checkpoint, index) => {
    const base = checkpoint.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `aid-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    return { ...checkpoint, id, plannedStopSeconds: checkpoint.plannedStopSeconds ?? 120 };
  });
}
