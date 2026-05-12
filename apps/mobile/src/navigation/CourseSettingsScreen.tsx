import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { DSButton, DSCard, DSTextInput, useDSTheme } from "../design-system";
import { ApiError, createApiClient } from "../api/client";
import { canEditRaceCourseFromRoomRole } from "../auth/roleGuards";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { ReadoutsStackParamList } from "./types";

function normalizeRaceStartIso(input: string): string | null {
  const t = Date.parse(input.trim());
  if (Number.isNaN(t)) {
    return null;
  }
  return new Date(t).toISOString();
}

export function CourseSettingsScreen(): ReactElement {
  const s = useAuthedShell();
  const theme = useDSTheme();
  const navigation = useNavigation<NativeStackNavigationProp<ReadoutsStackParamList, "CourseSettings">>();
  const selectedRaceName = useMemo(() => s.room?.name?.trim() || "No race selected", [s.room?.name]);

  const perms = s.roomDetail?.permissions;
  const canEditRaceStart =
    (perms?.canEditRaceSetup ?? canEditRaceCourseFromRoomRole(s.currentRoomRole)) === true;

  const anchorIso = useMemo(
    () => s.room?.raceStartAt ?? s.room?.activatedAt ?? "",
    [s.room?.raceStartAt, s.room?.activatedAt, s.room?.id]
  );

  const [draftRaceStartAt, setDraftRaceStartAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setDraftRaceStartAt(anchorIso);
  }, [anchorIso]);

  useFocusEffect(
    useCallback(() => {
      if (s.room?.id && s.auth.accessToken) {
        void s.onFetchRoomDetails(s.room.id);
      }
    }, [s.room?.id, s.auth.accessToken, s.onFetchRoomDetails])
  );

  const onSaveRaceStart = async (): Promise<void> => {
    setMessage(undefined);
    setError(undefined);
    if (!s.room?.id || !s.auth.accessToken) {
      setError("Select a race room and stay signed in.");
      return;
    }
    if (!s.room.course || s.room.course.checkpoints.length < 2) {
      setError("Save a course from Race setup before setting a race start time.");
      return;
    }
    const normalized = normalizeRaceStartIso(draftRaceStartAt);
    if (!normalized) {
      setError("Enter a valid date and time in ISO 8601 format (UTC), e.g. 2026-07-12T13:00:00.000Z");
      return;
    }
    if (!canEditRaceStart) {
      setError("You do not have permission to change the race start.");
      return;
    }
    setSaving(true);
    try {
      const client = createApiClient({ baseUrl: s.baseUrl, accessToken: s.auth.accessToken });
      const pace = s.room.plannedPaceSecondsPerKm;
      if (typeof pace !== "number" || !Number.isFinite(pace) || pace <= 0) {
        setError("Room is missing planned pace; re-save the course from Race setup first.");
        return;
      }
      const updated = await client.updateRaceCourse(s.room.id, {
        course: {
          checkpoints: s.room.course.checkpoints,
          baselineTrack: s.room.course.baselineTrack
        },
        plannedPaceSecondsPerKm: pace,
        raceStartAt: normalized,
        courseDistanceMeters: s.room.courseDistanceMeters,
        courseElevationGainMeters: s.room.courseElevationGainMeters,
        courseFileName: s.room.courseFileName
      });
      s.onApplyRaceRoomFromServer(updated);
      await s.onFetchRoomDetails(s.room.id);
      s.onFetchProjection();
      setMessage("Race start time saved.");
    } catch (e) {
      const text =
        e instanceof ApiError
          ? typeof e.body === "object" && e.body !== null && "error" in e.body
            ? String((e.body as { error: unknown }).error)
            : e.message
          : e instanceof Error
            ? e.message
            : "Save failed.";
      setError(text);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={s.styles.container} contentContainerStyle={[s.styles.scroll, { paddingBottom: 28 }]}>
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>Course settings</Text>
        <Text style={s.styles.subtitle}>Manage current-race setup actions for this tab.</Text>

        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>Selected race</Text>
          <Text style={s.styles.body}>{selectedRaceName}</Text>
        </DSCard>

        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>Race start (official clock)</Text>
          <Text style={s.styles.body}>
            Used for projection, Pace, and cutoffs. Enter UTC as ISO 8601 (same format as GPX setup).
          </Text>
          <DSTextInput
            value={draftRaceStartAt}
            onChangeText={(t) => {
              setDraftRaceStartAt(t);
              setError(undefined);
              setMessage(undefined);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="2026-07-12T13:00:00.000Z"
            editable={canEditRaceStart && !saving}
          />
          {!canEditRaceStart ? (
            <Text style={[s.styles.body, { marginTop: 8, color: theme.color.muted }]}>
              Only the athlete, crew chief, or team manager can change the race start.
            </Text>
          ) : null}
          {error ? <Text style={[s.styles.body, s.styles.errorText, { marginTop: 8 }]}>{error}</Text> : null}
          {message ? <Text style={[s.styles.body, s.styles.successText, { marginTop: 8 }]}>{message}</Text> : null}
          <View style={{ marginTop: 12 }}>
            <DSButton
              preset="primary"
              disabled={saving || !canEditRaceStart || normalizeRaceStartIso(draftRaceStartAt) === null}
              onPress={() => void onSaveRaceStart()}
            >
              {saving ? "Saving…" : "Save race start"}
            </DSButton>
          </View>
        </DSCard>

        <View style={{ gap: 8, marginTop: 12 }}>
          {s.room ? (
            <>
              <DSButton preset="secondary" onPress={() => navigation.navigate("CourseRaceSetup", { mode: "edit" })}>
                Race setup
              </DSButton>
              <DSButton
                preset="secondary"
                onPress={() => navigation.navigate("CourseRaceSetup", { mode: "edit", replaceCourseFile: true })}
              >
                Replace course file
              </DSButton>
            </>
          ) : null}
        </View>
      </DSCard>
    </ScrollView>
  );
}
