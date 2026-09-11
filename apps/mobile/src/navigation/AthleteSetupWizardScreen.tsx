import { useState, type ReactElement } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as Localization from "expo-localization";
import * as SecureStore from "../storage/secureStorage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSButton, DSTextInput, useDSTheme } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import { CourseImportProgressBar } from "../features/gpx/CourseImportProgressBar";
import {
  COURSE_IMPORT_PROGRESS,
  yieldForCourseImportPaint,
  type CourseImportProgressStage
} from "../features/gpx/courseImportProgress";
import {
  buildExpectedSplits,
  buildRaceCourseFromGpx,
  computeElevationGainMeters,
  parseCourseTrack,
  parsedTrackToWorkspaceLayer,
  type ParsedGpxTrack
} from "../features/gpx/gpxImport";
import { createApiClient } from "../api/client";
import { RaceStartSchedulePicker } from "../features/raceStart/RaceStartSchedulePicker";
import { defaultSuggestedRaceStartIso, normalizeRaceStartIso } from "../features/raceStart/raceStartSchedule";
import { ONBOARDING_INTENT_KEY } from "./onboardingState";

export function AthleteSetupWizardScreen(): ReactElement {
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
  const s = useAuthedShell();
  const [page, setPage] = useState(0);
  const [name, setName] = useState("");
  const [raceName, setRaceName] = useState("");
  const [parsed, setParsed] = useState<ParsedGpxTrack | undefined>(undefined);
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [pickingFile, setPickingFile] = useState(false);
  const [calcProgress, setCalcProgress] = useState<
    { fileName: string; ratio: number; message: string } | undefined
  >(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [raceStartIso, setRaceStartIso] = useState(() =>
    defaultSuggestedRaceStartIso(Localization.getCalendars()[0]?.timeZone ?? "UTC")
  );

  const setCalculatingStage = (nameForFile: string, stage: CourseImportProgressStage): void => {
    const { ratio, message } = COURSE_IMPORT_PROGRESS[stage];
    setCalcProgress({ fileName: nameForFile, ratio, message });
  };

  const onPick = async () => {
    setPickingFile(true);
    setCalcProgress(undefined);
    setError(undefined);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: false, copyToCacheDirectory: true });
      if (result.canceled) {
        return;
      }
      const selected = result.assets[0];
      const selectedName = selected.name || "route.gpx";
      setPickingFile(false);

      setCalculatingStage(selectedName, "reading");
      await yieldForCourseImportPaint();
      const raw = await FileSystemLegacy.readAsStringAsync(selected.uri);

      setCalculatingStage(selectedName, "parsing");
      await yieldForCourseImportPaint();
      const parsedTrack = parseCourseTrack(raw, selectedName);

      setCalculatingStage(selectedName, "calculating");
      await yieldForCourseImportPaint();
      // Touch split builder so the "calculating" stage covers the same work the preview uses.
      void buildExpectedSplits(parsedTrack, "mi");

      setParsed(parsedTrack);
      setFileName(selectedName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
      setParsed(undefined);
      setFileName(undefined);
    } finally {
      setPickingFile(false);
      setCalcProgress(undefined);
    }
  };

  const onFinish = async () => {
    if (!s.auth.accessToken || !raceName.trim() || !name.trim()) {
      setError("Add your name and race name first.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const room = await s.onCreateRoom({ raceName: raceName.trim(), creatorName: name.trim() });
      if (!room) throw new Error("Could not create race.");
      await s.onSaveRaceProfile({
        creatorName: name.trim(),
        raceName: raceName.trim(),
        raceDescription: "",
        crewName: "",
        setupComplete: true
      });
    if (parsed && fileName) {
      const normalized = normalizeRaceStartIso(raceStartIso);
      if (!normalized) {
        setError("Choose a valid race start date and time before finishing with a GPX course.");
        return;
      }
      const { course, plannedPaceSecondsPerKm } = buildRaceCourseFromGpx(parsed);
      const client = createApiClient({ baseUrl: s.baseUrl, accessToken: s.auth.accessToken });
      const updatedRoom = await client.updateRaceCourse(room.id, {
        course,
        plannedPaceSecondsPerKm,
        raceStartAt: normalized,
        courseDistanceMeters: parsed.totalDistanceMeters,
          courseElevationGainMeters: computeElevationGainMeters(parsed.points),
          courseFileName: fileName,
          routeOverlayLayer: parsedTrackToWorkspaceLayer(fileName, parsed)
        });
        s.onApplyRaceRoomFromServer(updatedRoom);
      }
      await SecureStore.setItemAsync(ONBOARDING_INTENT_KEY, "none");
      await s.onRefreshOnboardingStage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish setup.");
    } finally {
      setBusy(false);
    }
  };

  const splits = parsed ? buildExpectedSplits(parsed, "mi").slice(0, 8) : [];

  const canAdvanceFromPage0 = name.trim().length > 0;
  const canAdvanceFromPage1 = raceName.trim().length > 0;
  const raceStartOk = !parsed || normalizeRaceStartIso(raceStartIso) !== null;
  const canFinish = name.trim().length > 0 && raceName.trim().length > 0 && raceStartOk && !calcProgress;

  const primaryNavDisabled =
    page === 2
      ? busy || !canFinish
      : page === 0
        ? !canAdvanceFromPage0
        : !canAdvanceFromPage1 || Boolean(calcProgress);

  const primaryNavLabel =
    page === 2 ? (busy ? "Finishing..." : "Finish setup") : "Next";

  const onPrimaryNav = () => {
    if (page === 2) {
      void onFinish();
    } else {
      setPage((v) => Math.min(2, v + 1));
    }
  };

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={[styles.scrollView, { backgroundColor: theme.color.background, paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
    >
      <Text style={[styles.title, { color: theme.color.authHeading }]}>Athlete setup</Text>
      {page === 0 ? (
        <View style={styles.page}>
          <Text style={[styles.heading, { color: theme.color.authAccent }]}>Page 1: Your name</Text>
          <DSTextInput value={name} onChangeText={setName} placeholder="Taylor Smith" autoCapitalize="words" />
        </View>
      ) : null}
      {page === 1 ? (
        <View style={styles.page}>
          <Text style={[styles.heading, { color: theme.color.authAccent }]}>Page 2: Race and GPX</Text>
          <DSTextInput value={raceName} onChangeText={setRaceName} placeholder="Silverton 100" autoCapitalize="words" />
          <Pressable
            style={[styles.secondaryButton, (pickingFile || calcProgress) && styles.buttonDisabled]}
            disabled={pickingFile || Boolean(calcProgress)}
            onPress={() => void onPick()}
            accessibilityLabel="Upload GPX route file"
          >
            <Text style={[styles.secondaryText, { color: theme.color.authSecondaryActionText }]}>
              {pickingFile
                ? "Opening files…"
                : calcProgress
                  ? "Working…"
                  : fileName
                    ? `Selected: ${fileName}`
                    : "Upload GPX / route file"}
            </Text>
          </Pressable>
          {calcProgress ? (
            <CourseImportProgressBar
              ratio={calcProgress.ratio}
              message={calcProgress.message}
              fileName={calcProgress.fileName}
            />
          ) : null}
        </View>
      ) : null}
      {page === 2 ? (
        <View style={styles.page}>
          <Text style={[styles.heading, { color: theme.color.authAccent }]}>Page 3: Splits preview</Text>
          {parsed ? (
            <>
              <Text style={[styles.body, { color: theme.color.authBody }]}>Race start (required with GPX)</Text>
              <RaceStartSchedulePicker valueIso={raceStartIso} onChange={setRaceStartIso} />
            </>
          ) : null}
          {splits.length ? (
            splits.map((split) => (
              <Text key={split.splitIndex} style={[styles.splitRow, { color: theme.color.authHeading }]}>
                {split.distanceLabel} • {split.elapsedLabel}
              </Text>
            ))
          ) : (
            <Text style={[styles.body, { color: theme.color.authBody }]}>
              Upload a route file to compute expected splits.
            </Text>
          )}
        </View>
      ) : null}

      {error ? <Text style={[styles.error, { color: theme.color.authErrorText }]}>{error}</Text> : null}
      <View style={styles.navRow}>
        <View style={styles.navButton}>
          <DSButton
            preset="authSecondary"
            disabled={page === 0}
            onPress={() => setPage((v) => Math.max(0, v - 1))}
            fullWidth
          >
            Back
          </DSButton>
        </View>
        <View style={styles.navButton}>
          <DSButton preset="authPrimary" disabled={primaryNavDisabled} onPress={onPrimaryNav} fullWidth>
            {primaryNavLabel}
          </DSButton>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 34, fontWeight: "800" },
  heading: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  page: { gap: 10 },
  body: { fontSize: 15 },
  splitRow: { fontSize: 15, paddingVertical: 2 },
  navRow: { marginTop: 8, flexDirection: "row", gap: 10 },
  navButton: {
    flex: 1,
    alignSelf: "stretch"
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: "#e7e5de",
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryText: { fontWeight: "700", fontSize: 16, paddingHorizontal: 10, textAlign: "center" },
  buttonDisabled: { opacity: 0.45 },
  error: { fontWeight: "600" }
});
