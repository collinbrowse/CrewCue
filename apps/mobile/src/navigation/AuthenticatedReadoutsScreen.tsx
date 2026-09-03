import type { RaceCheckpointSplitRow, RaceCourseCheckpoint, RaceCourseCheckpointCutoff } from "@crewcue/contracts";
import type { CompositeNavigationProp, RouteProp } from "@react-navigation/native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from "react-native";
import { cumulativeDistancesAlongCheckpoints } from "@crewcue/map-core";
import { hashIdempotencyPayload } from "../api/idempotencyKey";
import { getErrorMessage, mapApiError } from "@crewcue/platform-client";
import { createApiClient } from "../api/client";
import { useAction } from "../platform/useAction";
import { canEditCheckpointStopsFromRoomRole, canEditRaceCourseFromRoomRole } from "../auth/roleGuards";
import { DSButton, DSCard, DSTextInput, useDSTheme, type DSThemeTokens } from "../design-system";
import { secondsForDistance } from "../features/readouts/eta";
import {
  checkpointDisplayTitle,
  currentCheckpointOrFinishIndex,
  finishDeviationSeconds,
  formatClockFromElapsed,
  formatCutoffClockOnly,
  formatSignedMinutesDelta,
  paceRemainingVsPlanDisplay,
  paceTimeRemainingFromRaceStartLabel,
  isCheckpointCompletedUi,
  isAutoDwellAtCheckpoint,
  milesFromMeters,
  paceRailCheckpointRowModel,
  paceRailFinishRowModel,
  projectedElapsedSecondsAtSplit,
  resolvePaceAnchor
} from "../features/pace/timeline";
import { PaceTimelineRail } from "../features/pace/PaceTimelineRail";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { CrewMainTabParamList, ReadoutsStackParamList } from "./types";

type ReadoutsNav = CompositeNavigationProp<
  NativeStackNavigationProp<ReadoutsStackParamList, "ReadoutsHome">,
  BottomTabNavigationProp<CrewMainTabParamList>
>;

const DEFAULT_PLANNED_STOP = 600;
const EST_ROW_HEIGHT = 132;

export function AuthenticatedReadoutsScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<ReadoutsNav>();
  const route = useRoute<RouteProp<ReadoutsStackParamList, "ReadoutsHome">>();
  const room = s.room;
  const projection = s.projection;
  const scrollRef = useRef<ScrollView>(null);
  const rowYRef = useRef<Record<string, number>>({});
  const didAutoScrollRef = useRef(false);

  const [editing, setEditing] = useState(false);
  const [draftCp, setDraftCp] = useState<RaceCourseCheckpoint[]>(room?.course?.checkpoints ?? []);
  const [draftStops, setDraftStops] = useState<Record<string, { arrival: string; departure: string }>>({});
  const [cutoffTod, setCutoffTod] = useState<Record<string, string>>({});
  const [cutoffElapsedMin, setCutoffElapsedMin] = useState<Record<string, string>>({});
  const { execute: executeSave, isPending: saving } = useAction<void>("pace:save", "lock");
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const editBaselineRef = useRef<{ stagedJson: string; stopsJson: string } | null>(null);

  const theme = useDSTheme();
  const paceStyles = useMemo(() => createPaceStyles(theme), [theme]);

  const paceSecondsPerKm = projection?.plannedPaceSecondsPerKm ?? room?.plannedPaceSecondsPerKm ?? 480;
  const perms = s.roomDetail?.permissions;
  const canEditCourse = (perms?.canEditRaceSetup ?? canEditRaceCourseFromRoomRole(s.currentRoomRole)) === true;
  const canEditStops = (perms?.canEditCheckpointStops ?? canEditCheckpointStopsFromRoomRole(s.currentRoomRole)) === true;

  const [segmentClockMs, setSegmentClockMs] = useState(() => Date.now());
  useEffect(() => {
    if (room?.status === "completed") {
      return undefined;
    }
    const id = setInterval(() => setSegmentClockMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [room?.status]);

  const checkpoints = room?.course?.checkpoints ?? [];
  const splits = projection?.checkpointSplits ?? [];
  const splitById = useMemo(() => new Map(splits.map((r) => [r.checkpointId, r])), [splits]);

  const raceAnchorIso = room?.raceStartAt ?? room?.activatedAt;
  const raceAnchorMs = useMemo(() => {
    if (!raceAnchorIso) {
      return NaN;
    }
    const t = Date.parse(raceAnchorIso);
    return Number.isNaN(t) ? NaN : t;
  }, [raceAnchorIso]);

  const anchor = useMemo(
    () => (!Number.isNaN(raceAnchorMs) ? resolvePaceAnchor(splits, raceAnchorMs) : null),
    [splits, raceAnchorMs]
  );

  const currentIx = useMemo(
    () => (checkpoints.length > 0 ? currentCheckpointOrFinishIndex(checkpoints, splits) : 0),
    [checkpoints, splits]
  );

  const cumMetersAtCp = useMemo(() => {
    const cps = room?.course?.checkpoints;
    if (!cps?.length) {
      return [] as number[];
    }
    /** Prefer arc distances from the saved course (PUT recomputes with canonical projection); splits can lag after course edits. */
    const aligned = cps.map((cp) => {
      if (typeof cp.distanceMetersFromStart === "number" && Number.isFinite(cp.distanceMetersFromStart)) {
        return cp.distanceMetersFromStart;
      }
      const row = splitById.get(cp.id);
      if (typeof row?.distanceMetersFromStart === "number" && Number.isFinite(row.distanceMetersFromStart)) {
        return row.distanceMetersFromStart;
      }
      return Number.NaN;
    });
    if (aligned.every((d) => Number.isFinite(d))) {
      return aligned;
    }
    if (cps.every((c) => typeof c.distanceMetersFromStart === "number" && Number.isFinite(c.distanceMetersFromStart))) {
      return cps.map((c) => c.distanceMetersFromStart!);
    }
    return cumulativeDistancesAlongCheckpoints(cps);
  }, [room?.course?.checkpoints, splitById]);

  useFocusEffect(
    useCallback(() => {
      if (!s.auth.accessToken || !room?.id) {
        return undefined;
      }
      // List snapshots set `room` but not `roomDetail`; permissions for Edit live on the detail payload.
      if (!s.roomDetail || s.roomDetail.room.id !== room.id) {
        void s.onFetchRoomDetails(room.id);
      }
      if (room.status === "completed") {
        return undefined;
      }
      s.onRefreshProjectionQuiet();
      s.onSetProjectionPollEnabled(true);
      return () => {
        s.onSetProjectionPollEnabled(false);
      };
    }, [
      room?.id,
      room?.status,
      s.auth.accessToken,
      s.roomDetail,
      s.onFetchRoomDetails,
      s.onRefreshProjectionQuiet,
      s.onSetProjectionPollEnabled
    ])
  );

  useEffect(() => {
    if (!editing) {
      setDraftCp(room?.course?.checkpoints ?? []);
    }
  }, [room?.id, room?.course?.checkpoints, editing]);

  const beginEdit = useCallback(() => {
    if (!room?.course?.checkpoints) {
      return;
    }
    const nextCp = structuredClone(room.course.checkpoints);
    const stops: Record<string, { arrival: string; departure: string }> = {};
    const tod: Record<string, string> = {};
    const el: Record<string, string> = {};
    for (const cp of nextCp) {
      const sp = splitById.get(cp.id);
      const ex = sp ? extractStopDraft(sp) : null;
      if (ex) {
        stops[cp.id] = ex;
      } else {
        stops[cp.id] = { arrival: "", departure: "" };
      }
      if (cp.cutoff?.mode === "time_of_day") {
        tod[cp.id] = `${String(cp.cutoff.hour).padStart(2, "0")}:${String(cp.cutoff.minute).padStart(2, "0")}`;
      } else {
        tod[cp.id] = "";
      }
      if (cp.cutoff?.mode === "elapsed_from_start") {
        el[cp.id] = String(Math.round(cp.cutoff.seconds / 60));
      } else {
        el[cp.id] = "";
      }
    }
    setDraftCp(nextCp);
    setDraftStops(stops);
    setCutoffTod(tod);
    setCutoffElapsedMin(el);
    const staged = nextCp.map((c) => ({
      ...c,
      cutoff: parseCutoffFields(c.id, tod[c.id], el[c.id])
    }));
    editBaselineRef.current = {
      stagedJson: JSON.stringify(staged),
      stopsJson: JSON.stringify(stops)
    };
    setEditing(true);
    setSaveError(undefined);
  }, [room?.course?.checkpoints, splitById]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraftCp(room?.course?.checkpoints ?? []);
    setDraftStops({});
    setCutoffTod({});
    setCutoffElapsedMin({});
    editBaselineRef.current = null;
    setSaveError(undefined);
  }, [room?.course?.checkpoints]);

  const courseDirty = useMemo(() => {
    if (!editing || !editBaselineRef.current) {
      return false;
    }
    const staged = draftCp.map((c) => ({
      ...c,
      cutoff: parseCutoffFields(c.id, cutoffTod[c.id], cutoffElapsedMin[c.id])
    }));
    return JSON.stringify(staged) !== editBaselineRef.current.stagedJson;
  }, [draftCp, cutoffTod, cutoffElapsedMin, editing]);

  const stopsDirty = useMemo(() => {
    if (!editing || !editBaselineRef.current) {
      return false;
    }
    return JSON.stringify(draftStops) !== editBaselineRef.current.stopsJson;
  }, [draftStops, editing]);

  const hasEditChanges = courseDirty || stopsDirty;

  useFocusEffect(
    useCallback(() => {
      const pick = route.params?.pacePickResult;
      if (!pick) {
        return;
      }
      if (!editing) {
        navigation.setParams({ pacePickResult: undefined });
        return;
      }
      const id = `aid-${Date.now()}`;
      setDraftCp((prev) => {
        const n = prev.length + 1;
        return [
          ...prev,
          {
            id,
            title: `Station ${n}`,
            latitude: pick.latitude,
            longitude: pick.longitude,
            plannedStopSeconds: DEFAULT_PLANNED_STOP
          }
        ];
      });
      setDraftStops((prev) => ({ ...prev, [id]: { arrival: "", departure: "" } }));
      setCutoffTod((prev) => ({ ...prev, [id]: "" }));
      setCutoffElapsedMin((prev) => ({ ...prev, [id]: "" }));
      navigation.setParams({ pacePickResult: undefined });
    }, [route.params?.pacePickResult, navigation, editing])
  );

  useEffect(() => {
    if (editing || didAutoScrollRef.current || !scrollRef.current || checkpoints.length === 0) {
      return;
    }
    const targetId = currentIx >= checkpoints.length ? "__finish__" : checkpoints[currentIx]?.id;
    if (!targetId) {
      return;
    }
    const y = rowYRef.current[targetId];
    if (y === undefined) {
      return;
    }
    const estimatedCenter = Math.max(0, y - EST_ROW_HEIGHT * 2);
    scrollRef.current.scrollTo({ y: estimatedCenter, animated: true });
    didAutoScrollRef.current = true;
  }, [editing, currentIx, checkpoints, splits.length]);

  const onSave = (): void => {
    void executeSave(async (signal) => {
    if (!room?.id || !s.auth.accessToken) {
      setSaveError(getErrorMessage("unknown"));
      return;
    }
    setSaveError(undefined);
    try {
      const client = createApiClient({ baseUrl: s.baseUrl, accessToken: s.auth.accessToken });
      let checkpointIdsForStops = draftCp.map((c) => c.id);

      if (courseDirty && canEditCourse) {
        const anchorIso = room.raceStartAt ?? room.activatedAt;
        if (!anchorIso) {
          setSaveError(getErrorMessage("invalidInput"));
          return;
        }
        const staged = draftCp.map((cp) => ({
          ...cp,
          cutoff: parseCutoffFields(cp.id, cutoffTod[cp.id], cutoffElapsedMin[cp.id])
        }));
        const normalizedCheckpoints = normalizeCheckpointDraft(staged);
        checkpointIdsForStops = normalizedCheckpoints.map((c) => c.id);
        const courseBody = {
          course: {
            checkpoints: normalizedCheckpoints,
            baselineTrack: room.course?.baselineTrack
          },
          plannedPaceSecondsPerKm: paceSecondsPerKm,
          raceStartAt: anchorIso,
          courseDistanceMeters: room.courseDistanceMeters,
          courseElevationGainMeters: room.courseElevationGainMeters,
          courseFileName: room.courseFileName
        };
        const payloadHash = await hashIdempotencyPayload(courseBody);
        const updatedRoom = await client.updateRaceCourse(room.id, courseBody, {
          idempotencyKey: `pace:save:course:${room.id}:${payloadHash}`,
          signal
        });
        s.onApplyRaceRoomFromServer(updatedRoom);
      } else if (courseDirty && !canEditCourse) {
        setSaveError(getErrorMessage("forbidden"));
        return;
      }

      if (stopsDirty && canEditStops) {
        const baseline = editBaselineRef.current
          ? (JSON.parse(editBaselineRef.current.stopsJson) as Record<string, { arrival: string; departure: string }>)
          : {};
        for (let i = 0; i < draftCp.length; i++) {
          const oldId = draftCp[i]!.id;
          const cpId = checkpointIdsForStops[i] ?? oldId;
          const next = draftStops[oldId];
          const prev = baseline[oldId];
          if (!next?.arrival || !next.departure) {
            continue;
          }
          if (!prev || prev.arrival !== next.arrival || prev.departure !== next.departure) {
            s.onEnqueueManualStop(cpId, next.arrival, next.departure);
          }
        }
      } else if (stopsDirty && !canEditStops) {
        setSaveError(getErrorMessage("forbidden"));
        return;
      }

      await s.onFetchRoomDetails(room.id);
      s.onFetchProjection();
      setEditing(false);
      editBaselineRef.current = null;
      didAutoScrollRef.current = false;
    } catch (error) {
      setSaveError(mapApiError(error, "saveFailed").message);
    }
    });
  };

  const openMapPicker = useCallback(() => {
    const last = draftCp[draftCp.length - 1];
    navigation.navigate("Map", {
      screen: "CheckpointPickMap",
      params: {
        initialLatitude: last?.latitude,
        initialLongitude: last?.longitude
      }
    });
  }, [navigation, draftCp]);

  const onRowLayout = (id: string) => (e: LayoutChangeEvent) => {
    rowYRef.current[id] = e.nativeEvent.layout.y;
  };

  if (!room) {
    return (
      <ScrollView style={s.styles.container} contentContainerStyle={s.styles.scroll}>
        <Text style={s.styles.body}>Select a race room to view Pace.</Text>
      </ScrollView>
    );
  }

  if (!room.course || room.course.checkpoints.length < 2) {
    return (
      <ScrollView style={s.styles.container} contentContainerStyle={[s.styles.scroll, paceStyles.empty]}>
        <Text style={s.styles.title}>Pace</Text>
        <Text style={[s.styles.subtitle, { marginBottom: 16 }]}>
          Upload a course file to see checkpoint times, cutoffs, and projections.
        </Text>
        <DSButton preset="primary" onPress={() => navigation.navigate("GpxImport")}>
          Upload a course file
        </DSButton>
      </ScrollView>
    );
  }

  const progressMeters = projection?.progressMeters ?? 0;
  const canonicalLenM =
    typeof room.course?.derivedMetrics?.canonicalDistanceMeters === "number" &&
    Number.isFinite(room.course.derivedMetrics.canonicalDistanceMeters) &&
    room.course.derivedMetrics.canonicalDistanceMeters > 0
      ? room.course.derivedMetrics.canonicalDistanceMeters
      : typeof room.courseDistanceMeters === "number" && Number.isFinite(room.courseDistanceMeters) && room.courseDistanceMeters > 0
        ? room.courseDistanceMeters
        : null;
  const fallbackCourseLengthM = cumMetersAtCp.length > 0 ? cumMetersAtCp[cumMetersAtCp.length - 1]! : 0;
  const effectiveCourseLenM =
    canonicalLenM ??
    (projection && projection.courseLengthMeters > 0 ? projection.courseLengthMeters : fallbackCourseLengthM);
  const progressRatio =
    effectiveCourseLenM > 0 ? Math.min(1, Math.max(0, progressMeters / effectiveCourseLenM)) : 0;
  const coveredMi = effectiveCourseLenM > 0 ? milesFromMeters(progressMeters) : 0;
  const courseMi = effectiveCourseLenM > 0 ? milesFromMeters(effectiveCourseLenM) : 0;
  const courseMiLabel = effectiveCourseLenM > 0 ? courseMi.toFixed(1) : "—";
  const coveredLabel = effectiveCourseLenM > 0 ? coveredMi.toFixed(1) : "—";

  const stale = projection?.projectionConfidence === "degraded";
  const staleSec = projection?.secondsSinceLastAcceptedPing;

  const finishPaceDeltaColor = (deltaSec: number) =>
    Math.abs(deltaSec) <= 60 ? theme.color.paceDeltaAhead : deltaSec > 0 ? theme.color.danger : theme.color.paceDeltaAhead;

  const lastCpMetersForFinish = cumMetersAtCp.length > 0 ? cumMetersAtCp[cumMetersAtCp.length - 1]! : 0;
  const finishRailModel =
    projection && !Number.isNaN(raceAnchorMs)
      ? paceRailFinishRowModel(currentIx, checkpoints.length, lastCpMetersForFinish, effectiveCourseLenM, progressMeters)
      : { isActiveLeg: false, fraction01: 0 };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={s.styles.container}
        contentContainerStyle={[s.styles.scroll, { paddingBottom: editing ? 100 : 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {stale ? (
          <View style={paceStyles.staleBanner}>
            <Text style={paceStyles.staleTitle}>Live data may be stale</Text>
            <Text style={paceStyles.staleBody}>
              Last accepted ping{" "}
              {typeof staleSec === "number" ? `≈ ${Math.round(staleSec / 60)} min ago` : "is unknown"}.
            </Text>
          </View>
        ) : null}

        <View style={paceStyles.headerBlock}>
          <Text style={paceStyles.kicker}>Course progress</Text>
          <View style={paceStyles.headerTitleRow}>
            <Text style={paceStyles.raceName} numberOfLines={2}>
              {room.name}
            </Text>
            <Text style={paceStyles.totalMiles}>
              {courseMiLabel}
              {"\n"}
              <Text style={paceStyles.totalMilesLabel}>total mi</Text>
            </Text>
          </View>
          <Text style={paceStyles.progressCaption}>
            {coveredLabel} mi covered
            {effectiveCourseLenM > 0 ? ` · ${Math.round(progressRatio * 100)}%` : ""}
          </Text>
          <View style={paceStyles.progressTrack}>
            <View style={[paceStyles.progressFill, { width: `${Math.round(progressRatio * 100)}%` }]} />
          </View>
        </View>

        {!editing ? (
          <View style={paceStyles.editRow}>
            <DSButton preset="secondary" onPress={beginEdit} disabled={!canEditCourse && !canEditStops}>
              Edit
            </DSButton>
          </View>
        ) : (
          <View style={paceStyles.editRowSplit}>
            <DSButton preset="secondary" onPress={cancelEdit}>
              Cancel
            </DSButton>
            <DSButton preset="secondary" onPress={openMapPicker} disabled={!canEditCourse}>
              Add from map
            </DSButton>
          </View>
        )}

        {Number.isNaN(raceAnchorMs) ? (
          <Text style={[paceStyles.activateHint, s.styles.warningText]}>
            Set a race start time when saving the course (GPX setup) so Pace can anchor on the official clock.
          </Text>
        ) : null}

        {checkpoints.map((cp, index) => {
          const split = splitById.get(cp.id);
          const isCurrent = index === currentIx;
          const completed = split ? isCheckpointCompletedUi(split) : false;
          const inProgressHere = isCurrent && !completed && index < checkpoints.length;
          const stationLabel = checkpointDisplayTitle(cp);
          const distMetersAtCp =
            typeof cp.distanceMetersFromStart === "number" && Number.isFinite(cp.distanceMetersFromStart)
              ? cp.distanceMetersFromStart
              : (split?.distanceMetersFromStart ?? cumMetersAtCp[index] ?? 0);
          const distMi = milesFromMeters(distMetersAtCp);
          const plannedElapsed =
            split?.plannedElapsedSecondsAtCross ?? secondsForDistance(distMetersAtCp, paceSecondsPerKm);
          const projElapsed =
            split && !Number.isNaN(raceAnchorMs)
              ? projectedElapsedSecondsAtSplit(split, index, anchor, raceAnchorMs)
              : plannedElapsed;
          const cutoffClock = formatCutoffClockOnly(cp.cutoff, Number.isNaN(raceAnchorMs) ? null : raceAnchorMs);
          const clock =
            !Number.isNaN(raceAnchorMs) ? formatClockFromElapsed(raceAnchorMs, projElapsed) : "—";
          const plannedStopForDwell = split?.plannedStopSeconds ?? cp.plannedStopSeconds ?? DEFAULT_PLANNED_STOP;
          const dwellHere = Boolean(split && isAutoDwellAtCheckpoint(split) && isCurrent && !completed);
          const railModel = paceRailCheckpointRowModel(
            index,
            currentIx,
            checkpoints.length,
            cumMetersAtCp,
            progressMeters,
            split,
            plannedStopForDwell,
            segmentClockMs,
            completed
          );

          const displayElapsedSeconds =
            completed && split?.actualElapsedSecondsAtCross != null
              ? split.actualElapsedSecondsAtCross
              : projElapsed;
          // Time remaining = race-clock duration from start to this station (not wall-clock countdown from now).
          const timeRemainLabel = paceTimeRemainingFromRaceStartLabel(displayElapsedSeconds);
          const vsPlanUnderTimeRemain = paceRemainingVsPlanDisplay(displayElapsedSeconds - plannedElapsed);
          const vsPlanUnderTimeRemainColor =
            vsPlanUnderTimeRemain.kind === "slower" ? theme.color.danger : theme.color.paceDeltaAhead;

          return (
            <View key={cp.id} style={paceStyles.timelineRow} onLayout={onRowLayout(cp.id)}>
              <PaceTimelineRail
                theme={theme}
                isActiveLeg={railModel.isActiveLeg}
                completed={completed}
                fraction01={railModel.fraction01}
              />

              <View
                style={[
                  paceStyles.cpCardShell,
                  dwellHere && paceStyles.cpCardAtStation,
                  isCurrent && !dwellHere && paceStyles.cpCardCurrent,
                  completed && paceStyles.cpCardPast
                ]}
              >
                <View style={paceStyles.cpHeaderRow}>
                  <Text style={paceStyles.cpIndexDist}>
                    CP{index + 1} — {distMi.toFixed(1)} MI
                  </Text>
                  {inProgressHere ? (
                    <View style={paceStyles.inProgressBadge}>
                      <Text style={paceStyles.inProgressBadgeText}>{dwellHere ? "At station" : "In progress"}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[paceStyles.cpStationName, completed && paceStyles.cpStationNamePast]} numberOfLines={2}>
                  {stationLabel}
                </Text>
                <View style={paceStyles.cpDivider} />
                {editing ? (
                  <View style={{ gap: 8 }}>
                    <DSTextInput
                      value={cp.title ?? ""}
                      onChangeText={(t) => setDraftCp((p) => p.map((c) => (c.id === cp.id ? { ...c, title: t } : c)))}
                      placeholder="Station name"
                    />
                    <Text style={s.styles.label}>Cutoff (optional)</Text>
                    <DSTextInput
                      value={cutoffTod[cp.id] ?? ""}
                      onChangeText={(t) => setCutoffTod((prev) => ({ ...prev, [cp.id]: t }))}
                      placeholder="HH:MM time of day"
                    />
                    <DSTextInput
                      value={cutoffElapsedMin[cp.id] ?? ""}
                      onChangeText={(t) => setCutoffElapsedMin((prev) => ({ ...prev, [cp.id]: t }))}
                      placeholder="Or minutes from start"
                      keyboardType="number-pad"
                    />
                    <Text style={s.styles.label}>Arrival / departure (ISO)</Text>
                    <DSTextInput
                      value={draftStops[cp.id]?.arrival ?? ""}
                      onChangeText={(t) =>
                        setDraftStops((prev) => ({ ...prev, [cp.id]: { arrival: t, departure: prev[cp.id]?.departure ?? "" } }))
                      }
                      placeholder="2026-05-11T12:00:00.000Z"
                    />
                    <DSTextInput
                      value={draftStops[cp.id]?.departure ?? ""}
                      onChangeText={(t) =>
                        setDraftStops((prev) => ({ ...prev, [cp.id]: { arrival: prev[cp.id]?.arrival ?? "", departure: t } }))
                      }
                      placeholder="2026-05-11T12:10:00.000Z"
                    />
                    <View style={paceStyles.row}>
                      <DSButton preset="secondary" onPress={() => setDraftCp((p) => moveCheckpoint(p, index, -1))} disabled={index === 0}>
                        Up
                      </DSButton>
                      <DSButton
                        preset="secondary"
                        onPress={() => setDraftCp((p) => moveCheckpoint(p, index, 1))}
                        disabled={index === draftCp.length - 1}
                      >
                        Down
                      </DSButton>
                      <DSButton preset="secondary" onPress={() => setDraftCp((p) => p.filter((_, i) => i !== index))} disabled={completed}>
                        Remove
                      </DSButton>
                    </View>
                  </View>
                ) : inProgressHere ? (
                  index === 0 ? (
                    <View style={paceStyles.triWrap}>
                      <View style={paceStyles.triCol}>
                        <Text style={paceStyles.microLabel}>Race start</Text>
                        <Text style={paceStyles.timePrimary}>
                          {!Number.isNaN(raceAnchorMs) ? formatClockFromElapsed(raceAnchorMs, 0) : "—"}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={paceStyles.triWrap}>
                      <View style={paceStyles.triCol}>
                        <Text style={paceStyles.microLabel}>Est. arrival</Text>
                        <Text style={paceStyles.timePrimary}>{clock}</Text>
                      </View>
                      <View style={paceStyles.triCol}>
                        {cutoffClock ? (
                          <>
                            <Text style={paceStyles.microLabel}>Cutoff</Text>
                            <Text style={paceStyles.cutoffRed}>{cutoffClock}</Text>
                          </>
                        ) : (
                          <>
                            <Text style={paceStyles.microLabel}>Cutoff</Text>
                            <Text style={paceStyles.timeMuted}>—</Text>
                          </>
                        )}
                      </View>
                      <View style={paceStyles.triCol}>
                        <Text style={paceStyles.microLabel}>Time remaining</Text>
                        <Text
                          style={paceStyles.timeSecondary}
                          accessibilityLabel={`Time remaining from race start ${timeRemainLabel}`}
                        >
                          {timeRemainLabel}
                        </Text>
                        <Text style={[paceStyles.timeMuted, { marginTop: 2, fontSize: 12, color: vsPlanUnderTimeRemainColor }]}>
                          {vsPlanUnderTimeRemain.label}
                        </Text>
                      </View>
                    </View>
                  )
                ) : index === 0 ? (
                  <View style={paceStyles.triWrap}>
                    <View style={paceStyles.triCol}>
                      <Text style={paceStyles.microLabel}>Race start</Text>
                      <Text style={[paceStyles.timePrimary, completed && paceStyles.mainTimePast]}>
                        {!Number.isNaN(raceAnchorMs) ? formatClockFromElapsed(raceAnchorMs, 0) : "—"}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={paceStyles.triWrap}>
                    <View style={paceStyles.triCol}>
                      <Text style={paceStyles.microLabel}>Est. arrival</Text>
                      <Text style={[paceStyles.timePrimary, completed && paceStyles.mainTimePast]}>{clock}</Text>
                    </View>
                    <View style={paceStyles.triCol}>
                      {cutoffClock ? (
                        <>
                          <Text style={paceStyles.microLabel}>Cutoff</Text>
                          <Text style={paceStyles.cutoffRed}>{cutoffClock}</Text>
                        </>
                      ) : (
                        <>
                          <Text style={paceStyles.microLabel}>Cutoff</Text>
                          <Text style={paceStyles.timeMuted}>—</Text>
                        </>
                      )}
                    </View>
                    <View style={paceStyles.triCol}>
                      <Text style={paceStyles.microLabel}>Time remaining</Text>
                      <Text
                        style={paceStyles.timeSecondary}
                        accessibilityLabel={`Time remaining from race start ${timeRemainLabel}`}
                      >
                        {timeRemainLabel}
                      </Text>
                      <Text style={[paceStyles.timeMuted, { marginTop: 2, fontSize: 12, color: vsPlanUnderTimeRemainColor }]}>
                        {vsPlanUnderTimeRemain.label}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {projection && !Number.isNaN(raceAnchorMs) ? (
          <View style={paceStyles.timelineRow} onLayout={onRowLayout("__finish__")}>
            <PaceTimelineRail
              theme={theme}
              isActiveLeg={finishRailModel.isActiveLeg}
              completed={false}
              fraction01={finishRailModel.fraction01}
              variant="finish"
            />
            <View style={[paceStyles.cpCardShell, currentIx >= checkpoints.length ? paceStyles.cpCardCurrent : null]}>
              <View style={paceStyles.cpHeaderRow}>
                <Text style={paceStyles.cpIndexDist}>Finish</Text>
              </View>
              <Text style={paceStyles.cpStationName}>FINISH LINE</Text>
              <View style={paceStyles.cpDivider} />
              <Text style={paceStyles.oneLineOuter} numberOfLines={1} ellipsizeMode="tail">
                <Text style={paceStyles.oneLineClock}>
                  {new Date(projection.etaFinishPlanIso).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit"
                  })}
                </Text>
                <Text style={paceStyles.oneLineTag}> Target </Text>
                <Text
                  style={[
                    paceStyles.oneLineDelta,
                    { color: finishPaceDeltaColor(finishDeviationSeconds(projection, raceAnchorMs)) }
                  ]}
                >
                  {formatSignedMinutesDelta(finishDeviationSeconds(projection, raceAnchorMs))}
                </Text>
              </Text>
            </View>
          </View>
        ) : null}

        {editing ? (
          <View style={{ marginTop: 12 }}>
            <DSButton
              preset="secondary"
              onPress={() =>
                setDraftCp((prev) => [
                  ...prev,
                  {
                    id: `aid-${prev.length + 1}`,
                    title: `Station ${prev.length + 1}`,
                    latitude: prev[prev.length - 1]?.latitude ?? 0,
                    longitude: prev[prev.length - 1]?.longitude ?? 0,
                    plannedStopSeconds: DEFAULT_PLANNED_STOP
                  }
                ])
              }
              disabled={!canEditCourse}
            >
              Add checkpoint
            </DSButton>
          </View>
        ) : null}
      </ScrollView>

      {editing ? (
        <View style={paceStyles.saveBar}>
          {saveError ? <Text style={s.styles.errorText}>{saveError}</Text> : null}
          <DSButton preset="primary" onPress={() => void onSave()} disabled={!hasEditChanges || saving}>
            {saving ? <ActivityIndicator color={theme.color.onPrimary} /> : "Save"}
          </DSButton>
        </View>
      ) : null}
    </View>
  );
}

function extractStopDraft(split: RaceCheckpointSplitRow): { arrival: string; departure: string } | null {
  for (let i = split.visits.length - 1; i >= 0; i--) {
    const v = split.visits[i]!;
    if (v.manualEntry) {
      return { arrival: v.manualEntry.arrivalAt, departure: v.manualEntry.departureAt };
    }
    if (v.autoDetected?.arrivalRecordedAt && v.autoDetected.departureRecordedAt) {
      return { arrival: v.autoDetected.arrivalRecordedAt, departure: v.autoDetected.departureRecordedAt };
    }
  }
  return null;
}

function parseCutoffFields(
  _cpId: string,
  tod: string | undefined,
  elapsedMin: string | undefined
): RaceCourseCheckpointCutoff | undefined {
  const todTrim = tod?.trim() ?? "";
  const elTrim = elapsedMin?.trim() ?? "";
  if (elTrim.length > 0) {
    const n = Number.parseInt(elTrim, 10);
    if (Number.isFinite(n) && n >= 0) {
      return { mode: "elapsed_from_start", seconds: n * 60 };
    }
  }
  if (todTrim.length > 0) {
    const m = todTrim.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      const hour = Number.parseInt(m[1]!, 10);
      const minute = Number.parseInt(m[2]!, 10);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return { mode: "time_of_day", hour, minute };
      }
    }
  }
  return undefined;
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
    return { ...checkpoint, id, plannedStopSeconds: checkpoint.plannedStopSeconds ?? DEFAULT_PLANNED_STOP };
  });
}

function createPaceStyles(t: DSThemeTokens) {
  const { color, radius, spacing } = t;
  return StyleSheet.create({
    empty: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
    staleBanner: {
      backgroundColor: color.statusRail,
      borderRadius: radius.lg,
      padding: spacing.cardPadding,
      marginBottom: spacing.stackMd,
      borderWidth: 1,
      borderColor: color.divider
    },
    staleTitle: { fontWeight: "700", color: color.authHeading, fontSize: 14 },
    staleBody: { color: color.authBody, marginTop: 4, fontSize: 13 },
    activateHint: { marginBottom: 12, fontSize: 14, fontWeight: "600" },
    headerBlock: { marginBottom: spacing.stackMd },
    kicker: {
      color: color.primary,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 1.2,
      textTransform: "uppercase",
      marginBottom: 4
    },
    headerTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
    raceName: { flex: 1, color: color.text, fontSize: 24, fontWeight: "800", lineHeight: 28 },
    totalMiles: { color: color.primary, fontSize: 18, fontWeight: "800", textAlign: "right" },
    totalMilesLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
    progressCaption: { color: color.body, fontSize: 13, marginTop: 6 },
    progressTrack: {
      height: 8,
      borderRadius: radius.full,
      backgroundColor: color.divider,
      marginTop: 10,
      overflow: "hidden"
    },
    progressFill: {
      height: 8,
      backgroundColor: color.primary,
      borderRadius: radius.full
    },
    editRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: spacing.stackSm },
    editRowSplit: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: spacing.stackSm,
      gap: spacing.stackSm
    },
    timelineRow: { flexDirection: "row", alignItems: "stretch", marginBottom: spacing.stackSm },
    cpCardShell: {
      flex: 1,
      borderRadius: radius.lg,
      padding: spacing.cardPadding,
      backgroundColor: color.card,
      borderWidth: 1,
      borderColor: color.divider
    },
    cpCardCurrent: {
      borderColor: color.primary,
      borderWidth: 2,
      shadowColor: color.primary,
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3
    },
    cpCardPast: { opacity: 0.72 },
    cpCardAtStation: {
      backgroundColor: color.statusRail,
      borderLeftWidth: 3,
      borderLeftColor: color.primary
    },
    cpHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
    cpIndexDist: {
      color: color.primary,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 0.6,
      textTransform: "uppercase"
    },
    inProgressBadge: {
      backgroundColor: color.primary,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.full
    },
    inProgressBadgeText: {
      color: color.onPrimary,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 0.8,
      textTransform: "uppercase"
    },
    cpStationName: {
      color: color.text,
      fontSize: 17,
      fontWeight: "800",
      letterSpacing: 0.4,
      marginTop: 6
    },
    cpStationNamePast: { color: color.muted },
    cpDivider: {
      height: 1,
      backgroundColor: color.divider,
      marginVertical: 10
    },
    triWrap: { flexDirection: "row", justifyContent: "space-between", gap: 6, marginTop: 2 },
    triCol: { flex: 1, minWidth: 0, alignItems: "flex-start" },
    microLabel: {
      color: color.muted,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase",
      marginBottom: 4
    },
    timePrimary: { color: color.primary, fontSize: 16, fontWeight: "800" },
    timeSecondary: { color: color.text, fontSize: 15, fontWeight: "700" },
    timeMuted: { color: color.muted, fontSize: 15, fontWeight: "600" },
    cutoffRed: { color: color.danger, fontSize: 15, fontWeight: "900" },
    mainTimePast: { color: color.muted },
    oneLineOuter: { marginTop: 4 },
    oneLineClock: { color: color.text, fontSize: 17, fontWeight: "800" },
    oneLineTag: {
      color: color.muted,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.5,
      textTransform: "uppercase"
    },
    oneLineDelta: { fontSize: 14, fontWeight: "700" },
    oneLineExtra: { color: color.body, fontSize: 12 },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    saveBar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      padding: 16,
      backgroundColor: color.card,
      borderTopWidth: 1,
      borderTopColor: color.divider
    }
  });
}
