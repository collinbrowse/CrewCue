/**
 * __DEV__ only: Auth0-free QA for course-import progress while race splits calculate.
 * Entry: `crewcue://dev/gpx-import-progress` or `crewcue://course/dev-gpx-import-progress`
 */
import { useCallback, useState, type ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { DSButton, useDSTheme } from "../design-system";
import { CourseImportProgressBar } from "../features/gpx/CourseImportProgressBar";
import {
  COURSE_IMPORT_PROGRESS,
  yieldForCourseImportPaint,
  type CourseImportProgressStage
} from "../features/gpx/courseImportProgress";
import {
  buildExpectedSplits,
  buildRaceCourseFromGpx,
  parseCourseTrack
} from "../features/gpx/gpxImport";

/** Tiny timed track so agents can exercise progress without the Files picker. */
const DEV_MINI_COURSE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="crewcue-dev">
  <trk><name>dev-progress</name><trkseg>
    <trkpt lat="39.0" lon="-105.0"><ele>2000</ele><time>2026-08-01T12:00:00Z</time></trkpt>
    <trkpt lat="39.01" lon="-105.0"><ele>2050</ele><time>2026-08-01T12:10:00Z</time></trkpt>
    <trkpt lat="39.02" lon="-105.0"><ele>2100</ele><time>2026-08-01T12:20:00Z</time></trkpt>
    <trkpt lat="39.03" lon="-105.0"><ele>2150</ele><time>2026-08-01T12:30:00Z</time></trkpt>
  </trkseg></trk>
  <wpt lat="39.01" lon="-105.0"><name>Aid 1</name></wpt>
</gpx>`;

export function DevGpxImportProgressScreen(): ReactElement {
  const theme = useDSTheme();
  const [progress, setProgress] = useState<
    { fileName: string; ratio: number; message: string } | undefined
  >(undefined);
  const [result, setResult] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const busy = Boolean(progress);

  const setStage = (fileName: string, stage: CourseImportProgressStage): void => {
    const { ratio, message } = COURSE_IMPORT_PROGRESS[stage];
    setProgress({ fileName, ratio, message });
  };

  const onSimulate = useCallback(async () => {
    const fileName = "dev-progress.gpx";
    setError(undefined);
    setResult(undefined);
    try {
      setStage(fileName, "reading");
      await yieldForCourseImportPaint();
      await new Promise((r) => setTimeout(r, 900));

      setStage(fileName, "parsing");
      await yieldForCourseImportPaint();
      await new Promise((r) => setTimeout(r, 900));
      const parsed = parseCourseTrack(DEV_MINI_COURSE_GPX, fileName);

      setStage(fileName, "calculating");
      await yieldForCourseImportPaint();
      await new Promise((r) => setTimeout(r, 1100));
      const { course } = buildRaceCourseFromGpx(parsed);
      const splits = buildExpectedSplits(parsed, "mi");
      setResult(
        `Parsed ${course.checkpoints.length} checkpoints · ${splits.length} split row(s) · ${Math.round(parsed.totalDistanceMeters)} m`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulate import failed");
    } finally {
      setProgress(undefined);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void onSimulate();
    }, [onSimulate])
  );

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.color.background }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.title, { color: theme.color.text }]} accessibilityLabel="DEV GPX import progress title">
        Course import progress (DEV)
      </Text>
      <Text style={[styles.body, { color: theme.color.body }]}>
        Simulates post-selection stages (read → parse → calculate race splits) without Auth0 or the
        system file picker. Production UI lives on Race setup / Athlete setup.
      </Text>
      <View accessibilityLabel="Simulate course import progress">
        <DSButton preset="primary" disabled={busy} onPress={() => void onSimulate()}>
          {busy ? "Calculating…" : "Simulate course import"}
        </DSButton>
      </View>
      {progress ? (
        <CourseImportProgressBar
          ratio={progress.ratio}
          message={progress.message}
          fileName={progress.fileName}
        />
      ) : null}
      {result ? (
        <Text style={[styles.meta, { color: theme.color.text }]} accessibilityLabel="DEV GPX import result">
          {result}
        </Text>
      ) : null}
      {error ? (
        <Text style={[styles.error, { color: theme.color.danger }]} accessibilityLabel="DEV GPX import error">
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: "700" },
  body: { fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 14, fontWeight: "500" },
  error: { fontSize: 14, fontWeight: "600" }
});
