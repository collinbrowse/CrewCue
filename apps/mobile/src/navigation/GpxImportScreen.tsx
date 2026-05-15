import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as Localization from "expo-localization";
import type { RaceCourse } from "@crewcue/contracts";
import { ApiError, createApiClient } from "../api/client";
import { DSButton, DSCard, DSTextInput, useDSTheme } from "../design-system";
import { RaceStartSchedulePicker } from "../features/raceStart/RaceStartSchedulePicker";
import { defaultSuggestedRaceStartIso, normalizeRaceStartIso } from "../features/raceStart/raceStartSchedule";
import {
  buildRaceCourseFromGpx,
  computeElevationGainMeters,
  formatDistance,
  parseCourseTrack,
  parsedTrackToWorkspaceLayer,
  type DistanceUnit,
  type GpxTrackPoint,
  type ParsedGpxTrack
} from "../features/gpx/gpxImport";
import { useAuthedShell } from "../shell/AuthedShellContext";

type ImportState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "success";
      fileName: string;
      totalDistanceLabel: string;
      elevationLabel: string;
    }
  | { status: "error"; message: string };

type PendingCourseUpload = {
  fileName: string;
  course: RaceCourse;
  plannedPaceSecondsPerKm: number;
  totalDistanceMeters: number;
  elevationGainMeters: number;
  routeOverlayLayer: ReturnType<typeof parsedTrackToWorkspaceLayer>;
};

export function GpxImportScreen(): ReactElement {
  const s = useAuthedShell();
  const theme = useDSTheme();
  const navigation = useNavigation<any>();
  const route = useRoute();
  const routeParams = route.params as { mode?: "create" | "edit"; replaceCourseFile?: boolean } | undefined;
  const mode = routeParams?.mode ?? "edit";
  const isCreateMode = mode === "create";
  const replaceCourseFileMode = routeParams?.replaceCourseFile === true && !isCreateMode;
  const [importState, setImportState] = useState<ImportState>({ status: "idle" });
  const [raceName, setRaceName] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [raceDescription, setRaceDescription] = useState("");
  const [crewName, setCrewName] = useState("");
  const [finishingSetup, setFinishingSetup] = useState(false);
  const [pendingCourseUpload, setPendingCourseUpload] = useState<PendingCourseUpload | undefined>(undefined);
  const [raceStartIso, setRaceStartIso] = useState(() =>
    defaultSuggestedRaceStartIso(Localization.getCalendars()[0]?.timeZone ?? "UTC")
  );

  const activeUnit: DistanceUnit = "mi";

  useFocusEffect(
    useCallback(() => {
      if (!isCreateMode && s.room?.id && s.auth.accessToken) {
        void s.onFetchRoomDetails(s.room.id);
      }
    }, [isCreateMode, s.room?.id, s.auth.accessToken, s.onFetchRoomDetails])
  );
  useEffect(() => {
    if (isCreateMode) {
      setRaceName("");
      setCreatorName("");
      setRaceDescription("");
      setCrewName("");
      setPendingCourseUpload(undefined);
      setImportState({ status: "idle" });
      setRaceStartIso(defaultSuggestedRaceStartIso(Localization.getCalendars()[0]?.timeZone ?? "UTC"));
      return;
    }
    if (s.room) {
      setRaceName(s.room.name?.trim() || s.raceProfile?.raceName || "");
      setCreatorName(s.room.creatorName?.trim() || s.raceProfile?.creatorName?.trim() || "");
      setRaceDescription(s.room.description?.trim() || s.raceProfile?.raceDescription || "");
      setCrewName(s.room.crewName?.trim() || s.raceProfile?.crewName || "");
      return;
    }
    if (s.raceProfile) {
      setRaceName(s.raceProfile.raceName);
      setCreatorName(s.raceProfile.creatorName?.trim() || "");
      setRaceDescription(s.raceProfile.raceDescription);
      setCrewName(s.raceProfile.crewName);
    }
  }, [isCreateMode, s.raceProfile, s.room?.id, s.room?.name, s.room?.creatorName, s.room?.description, s.room?.crewName]);

  useEffect(() => {
    if (isCreateMode) {
      return;
    }
    const anchor = s.room?.raceStartAt ?? s.room?.activatedAt;
    const normalized = anchor?.trim() ? normalizeRaceStartIso(anchor) : null;
    if (normalized) {
      setRaceStartIso(normalized);
    }
  }, [isCreateMode, s.room?.id, s.room?.raceStartAt, s.room?.activatedAt]);

  useEffect(() => {
    if (isCreateMode) {
      return;
    }
    if (!s.room?.course && typeof s.room?.courseDistanceMeters !== "number") {
      return;
    }
    setImportState((current) => {
      if (current.status === "loading") {
        return current;
      }
      return buildImportStateFromCourse({
        fileName: s.room?.courseFileName ?? "Saved course",
        course: s.room?.course,
        storedDistanceMeters: s.room?.courseDistanceMeters,
        storedElevationGainMeters: s.room?.courseElevationGainMeters,
        unit: activeUnit
      });
    });
  }, [isCreateMode, activeUnit, s.room?.course, s.room?.courseDistanceMeters, s.room?.courseElevationGainMeters]);

  const persistedCourseState = useMemo(() => {
    if (isCreateMode) {
      return undefined;
    }
    if (!s.room?.course && typeof s.room?.courseDistanceMeters !== "number") {
      return undefined;
    }
    return buildImportStateFromCourse({
      fileName: s.room?.courseFileName ?? "Saved course",
      course: s.room?.course ?? { checkpoints: [] },
      storedDistanceMeters: s.room?.courseDistanceMeters,
      storedElevationGainMeters: s.room?.courseElevationGainMeters,
      unit: activeUnit
    });
  }, [isCreateMode, activeUnit, s.room?.course, s.room?.courseDistanceMeters, s.room?.courseElevationGainMeters, s.room?.courseFileName]);
  const visibleImportState = importState.status === "success" ? importState : persistedCourseState;

  const uploadFeedback = useMemo(() => {
    if (importState.status === "error") {
      return { tone: "error" as const, message: importState.message };
    }
    return undefined;
  }, [importState]);

  const normalizedRaceStart = useMemo(() => normalizeRaceStartIso(raceStartIso), [raceStartIso]);

  const canFinishSetup =
    raceName.trim().length > 0 &&
    creatorName.trim().length > 0 &&
    !finishingSetup &&
    normalizedRaceStart !== null &&
    (!replaceCourseFileMode || pendingCourseUpload !== undefined);

  const onImportGpx = async (): Promise<void> => {
    setImportState({ status: "loading" });

    try {
      const result = await DocumentPicker.getDocumentAsync({
        // iOS Files picker can hide GPX exports when MIME filters are too strict.
        // Allow selection broadly, then validate GPX content after read.
        type: "*/*",
        multiple: false,
        copyToCacheDirectory: true
      });

      if (result.canceled) {
        setImportState({
          status: "error",
          message: "Upload canceled. Choose a route file when you are ready."
        });
        return;
      }

      const selectedFile = result.assets[0];
      const fileContents = await FileSystemLegacy.readAsStringAsync(selectedFile.uri);
      const parsed = parseCourseTrack(fileContents, selectedFile.name);
      const unit: DistanceUnit = "mi";
      const { course, plannedPaceSecondsPerKm } = buildRaceCourseFromGpx(parsed);
      setPendingCourseUpload({
        fileName: selectedFile.name,
        course,
        plannedPaceSecondsPerKm,
        totalDistanceMeters: parsed.totalDistanceMeters,
        elevationGainMeters: computeElevationGainMeters(parsed.points),
        routeOverlayLayer: parsedTrackToWorkspaceLayer(selectedFile.name, parsed)
      });
      setImportState(buildImportStateFromParsedTrack(selectedFile.name, parsed, unit));
    } catch (error) {
      setPendingCourseUpload(undefined);
      const message = resolveImportErrorMessage(error, "We could not read that file. Please choose GPX, KML, or JSON and try again.");
      setImportState({ status: "error", message });
    }
  };

  const onFinishSetup = async (): Promise<void> => {
    if (!raceName.trim() || !creatorName.trim()) {
      setImportState({ status: "error", message: "Race name and your name are required to finish setup." });
      return;
    }

    if (!normalizedRaceStart) {
      setImportState({ status: "error", message: "Choose a valid race start date and time before saving." });
      return;
    }

    if (replaceCourseFileMode && !pendingCourseUpload) {
      setImportState({
        status: "error",
        message: "Select a new route file with “Select new file” before saving the replacement course."
      });
      return;
    }

    setFinishingSetup(true);
    try {
      const createInput = {
        raceName: raceName.trim(),
        creatorName: creatorName.trim(),
        raceDescription: raceDescription.trim(),
        crewName: crewName.trim()
      };
      let room = isCreateMode ? await s.onCreateRoom(createInput) : s.room;
      if (!room) {
        room = await s.onCreateRoom(createInput);
      }
      if (!room) {
        setImportState({ status: "error", message: "Could not create your race. Try again." });
        return;
      }

      await s.onSaveRaceProfile({
        creatorName: creatorName.trim(),
        raceName: raceName.trim(),
        raceDescription: raceDescription.trim(),
        crewName: crewName.trim(),
        setupComplete: true
      });

      if (pendingCourseUpload) {
        if (!s.auth.accessToken) {
          setImportState({ status: "error", message: "Sign in again before finishing route upload." });
          return;
        }
        const client = createApiClient({ baseUrl: s.baseUrl, accessToken: s.auth.accessToken });
        const updatedRoom = await client.updateRaceCourse(room.id, {
          course: pendingCourseUpload.course,
          plannedPaceSecondsPerKm: pendingCourseUpload.plannedPaceSecondsPerKm,
          raceStartAt: normalizedRaceStart,
          courseDistanceMeters: pendingCourseUpload.totalDistanceMeters,
          courseElevationGainMeters: pendingCourseUpload.elevationGainMeters,
          courseFileName: pendingCourseUpload.fileName,
          routeOverlayLayer: pendingCourseUpload.routeOverlayLayer
        });
        s.onApplyRaceRoomFromServer(updatedRoom);
        setPendingCourseUpload(undefined);
      } else if (
        !isCreateMode &&
        room.course &&
        room.course.checkpoints.length >= 2 &&
        s.auth.accessToken
      ) {
        const prev = normalizeRaceStartIso(room.raceStartAt ?? room.activatedAt ?? "");
        if (prev !== normalizedRaceStart) {
          const pace = room.plannedPaceSecondsPerKm;
          if (typeof pace !== "number" || !Number.isFinite(pace) || pace <= 0) {
            setImportState({
              status: "error",
              message: "This race is missing planned pace. Re-upload the course file once, then set the race start."
            });
            return;
          }
          const client = createApiClient({ baseUrl: s.baseUrl, accessToken: s.auth.accessToken });
          const updatedRoom = await client.updateRaceCourse(room.id, {
            course: {
              checkpoints: room.course.checkpoints,
              baselineTrack: room.course.baselineTrack
            },
            plannedPaceSecondsPerKm: pace,
            raceStartAt: normalizedRaceStart,
            courseDistanceMeters: room.courseDistanceMeters,
            courseElevationGainMeters: room.courseElevationGainMeters,
            courseFileName: room.courseFileName
          });
          s.onApplyRaceRoomFromServer(updatedRoom);
        }
      }

      await s.onFetchRoomDetails(room.id);
      await s.onFetchProjection();
      await s.onFetchMyRaceRooms();
      navigation.goBack();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 405 || error.status === 501)) {
        setImportState({
          status: "error",
          message: "Route upload endpoint is unavailable right now. Try again in a few moments."
        });
        return;
      }
      setImportState({
        status: "error",
        message: resolveImportErrorMessage(error, "Could not finish setup. Please try again.")
      });
    } finally {
      setFinishingSetup(false);
    }
  };

  return (
    <ScrollView
      style={s.styles.container}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>{replaceCourseFileMode ? "Replace course file" : "Race setup"}</Text>
        <Text style={s.styles.subtitle}>
          {replaceCourseFileMode
            ? "Upload a new GPX, KML, or JSON file to replace this race course."
            : "Add race details, optionally upload GPX, and share your crew link"}
        </Text>

        <Text style={[localStyles.fieldTitle, { color: theme.color.text }]}>Race name (required)</Text>
        <DSTextInput
          value={raceName}
          onChangeText={setRaceName}
          autoCapitalize="words"
        />

        <Text style={[localStyles.fieldTitle, { color: theme.color.text }]}>Your name (required)</Text>
        <DSTextInput value={creatorName} onChangeText={setCreatorName} autoCapitalize="words" />

        <Text style={[localStyles.fieldTitle, { color: theme.color.text }]}>Race description (optional)</Text>
        <DSTextInput
          value={raceDescription}
          onChangeText={setRaceDescription}
          placeholder="Notes about course conditions, strategy, or goals"
          multiline
          numberOfLines={3}
          style={{ minHeight: 88, textAlignVertical: "top" }}
        />

        <Text style={[localStyles.fieldTitle, { color: theme.color.text }]}>Crew name (optional)</Text>
        <DSTextInput
          value={crewName}
          onChangeText={setCrewName}
          autoCapitalize="words"
        />

        <Text style={[localStyles.fieldTitle, { color: theme.color.text }]}>Race start (official clock)</Text>
        {pendingCourseUpload ? (
          <Text style={[s.styles.body, { marginBottom: 4 }]}>
            Required with a new course file so Pace and projections use the correct start.
          </Text>
        ) : null}
        <RaceStartSchedulePicker valueIso={raceStartIso} onChange={setRaceStartIso} />

        <Text style={[localStyles.fieldTitle, { color: theme.color.text }]}>Upload route file (optional)</Text>
        <Text style={s.styles.body}>
          Uploading GPX, KML, or JSON generates shared course distance, aid-station split timing, and pacing metadata for your crew.
        </Text>
        {visibleImportState ? (
          <View style={localStyles.fileDetails}>
            <Text style={s.styles.successText}>{visibleImportState.fileName}</Text>
            <Text style={s.styles.body}>
              {visibleImportState.totalDistanceLabel} • {visibleImportState.elevationLabel}
            </Text>
            <View style={localStyles.actionsRow}>
              <View style={localStyles.actionCell}>
                <DSButton preset="secondary" onPress={() => void onImportGpx()}>
                  Select new file
                </DSButton>
              </View>
            </View>
          </View>
        ) : (
          <View style={localStyles.actionsRow}>
            <View style={localStyles.actionCell}>
              <DSButton preset="secondary" onPress={() => void onImportGpx()} disabled={importState.status === "loading"}>
                {importState.status === "loading" ? "Uploading..." : "Choose route file"}
              </DSButton>
            </View>
          </View>
        )}
        {uploadFeedback ? (
          <DSCard style={localStyles.feedbackCard}>
            <Text
              style={[
                s.styles.body,
                uploadFeedback.tone === "error" ? s.styles.errorText : undefined
              ]}
            >
              {uploadFeedback.message}
            </Text>
          </DSCard>
        ) : null}

        <View style={{ marginTop: 14 }}>
          <DSButton preset="primary" disabled={!canFinishSetup} onPress={() => void onFinishSetup()}>
            {finishingSetup
              ? replaceCourseFileMode
                ? "Saving new course..."
                : "Finishing setup..."
              : replaceCourseFileMode
                ? "Save replacement course"
                : "Finish race setup"}
          </DSButton>
        </View>
      </DSCard>
    </ScrollView>
  );
}

function resolveImportErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return toUserFriendlyImportErrorMessage(error.message);
  }
  if (error instanceof Error) {
    return toUserFriendlyImportErrorMessage(error.message);
  }
  return fallback;
}

function toUserFriendlyImportErrorMessage(errorMessage: string): string {
  const normalized = errorMessage.toLowerCase();
  if (normalized.includes("deprecated") && normalized.includes("expo-file-system")) {
    return "We hit a file-reader issue. Please try again in a moment.";
  }
  if (normalized.includes("not a gpx export") || normalized.includes("<gpx>")) {
    return "That file is not a supported course route. Please choose GPX, KML, or JSON and try again.";
  }
  if (normalized.includes("unsupported course file type")) {
    return "Unsupported route type. Upload GPX, KML, or JSON.";
  }
  if (normalized.includes("empty")) {
    return "That file looks empty. Please choose a valid GPX export.";
  }
  if (normalized.includes("distance is zero")) {
    return "We could not detect movement in this route file. Please choose a file with track points.";
  }
  if (normalized.includes("track points")) {
    return "We could not read enough route points from this file. Please choose a standard route export.";
  }
  if (normalized.includes("race room")) {
    return "Create your race room first, then upload so your crew sees the same course data.";
  }
  if (
    normalized.includes("upload a gpx") ||
    normalized.includes("checkpoint-only courses are not supported") ||
    normalized.includes("full route line")
  ) {
    return "We need the full route track line, not just aid-station points. Select your GPX, KML, or JSON file again and finish setup so the track is uploaded.";
  }
  if (normalized.includes("course route data is invalid") || normalized.includes("could not be processed")) {
    return "The server could not compute distances along this route. Re-select the file; if it still fails, confirm the export includes a continuous track line.";
  }
  if (normalized.includes("invalid course payload")) {
    return "Some course or race-start fields were rejected. Confirm the race start date and time, then upload the route file again.";
  }
  if (normalized.includes("cannot remove visited checkpoint")) {
    return "You cannot remove an aid station your athlete has already reached.";
  }
  if (normalized.includes("insufficient permissions")) {
    return "You do not have permission to change this race setup.";
  }
  if (normalized.includes("entitlement")) {
    return "This race needs an active subscription before you can update the course.";
  }
  if (normalized.includes("forbidden")) {
    return "You do not have access to update this race.";
  }
  return "We could not save this route. Confirm the file is GPX, KML, or JSON with a track line and try again.";
}

function buildImportStateFromParsedTrack(
  fileName: string,
  parsedTrack: ParsedGpxTrack,
  unit: DistanceUnit
): Extract<ImportState, { status: "success" }> {
  return {
    status: "success",
    fileName,
    totalDistanceLabel: formatDistance(parsedTrack.totalDistanceMeters, unit),
    elevationLabel: formatElevationGain(parsedTrack.points)
  };
}

function buildImportStateFromCourse({
  fileName,
  course,
  storedDistanceMeters,
  storedElevationGainMeters,
  unit
}: {
  fileName: string;
  course?: RaceCourse;
  storedDistanceMeters?: number;
  storedElevationGainMeters?: number;
  unit: DistanceUnit;
}): Extract<ImportState, { status: "success" }> {
  const totalDistanceMeters =
    storedDistanceMeters ?? course?.baselineTrack?.points?.[course.baselineTrack.points.length - 1]?.distanceMetersFromStart ?? 0;
  return {
    status: "success",
    fileName,
    totalDistanceLabel: formatDistance(totalDistanceMeters, unit),
    elevationLabel: formatElevationGainFromMeters(storedElevationGainMeters)
  };
}

function formatElevationGain(points: GpxTrackPoint[]): string {
  return formatElevationGainFromMeters(computeElevationGainMeters(points));
}

function formatElevationGainFromMeters(gainMeters: number | undefined): string {
  if (typeof gainMeters !== "number" || !Number.isFinite(gainMeters)) {
    return "Vert --";
  }
  if (gainMeters <= 0) {
    return "0 ft gain";
  }
  const gainFeet = Math.round(gainMeters * 3.28084);
  return `${gainFeet.toLocaleString()} ft gain`;
}

const localStyles = StyleSheet.create({
  fieldTitle: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: "600"
  },
  actionsRow: { marginTop: 12, flexDirection: "row", gap: 8 },
  actionCell: { flex: 1 },
  fileDetails: { marginTop: 10, gap: 6 },
  feedbackCard: { marginTop: 8 }
});
