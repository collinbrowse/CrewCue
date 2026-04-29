import { useMemo, useState, type ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { DSButton, DSCard } from "../design-system";
import {
  buildExpectedSplits,
  formatDistanceKm,
  formatDuration,
  formatPace,
  parseGpxTrack,
  type ExpectedSplit,
  type ParsedGpxTrack
} from "../features/gpx/gpxImport";
import { useAuthedShell } from "../shell/AuthedShellContext";

type ImportState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "success";
      parsedTrack: ParsedGpxTrack;
      fileName: string;
      totalDistanceLabel: string;
      elapsedLabel: string;
      averagePaceLabel: string;
      splits: ExpectedSplit[];
      unit: "km" | "mi";
    }
  | { status: "error"; message: string };

export function GpxImportScreen(): ReactElement {
  const s = useAuthedShell();
  const [importState, setImportState] = useState<ImportState>({ status: "idle" });

  const canToggleUnit = importState.status === "success";
  const activeUnit = importState.status === "success" ? importState.unit : "km";

  const summaryNote = useMemo(() => {
    if (importState.status === "idle") {
      return "Import a GPX route to generate expected split times for your demo pacing narrative.";
    }
    if (importState.status === "loading") {
      return "Parsing GPX track and computing expected split times.";
    }
    if (importState.status === "error") {
      return importState.message;
    }
    return `Imported ${importState.fileName} successfully.`;
  }, [importState]);

  const onImportGpx = async (): Promise<void> => {
    setImportState({ status: "loading" });

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/gpx+xml", "application/xml", "text/xml"],
        multiple: false,
        copyToCacheDirectory: true
      });

      if (result.canceled) {
        setImportState({ status: "idle" });
        return;
      }

      const selectedFile = result.assets[0];
      const fileContents = await FileSystem.readAsStringAsync(selectedFile.uri);

      const parsed = parseGpxTrack(fileContents);
      const unit: "km" | "mi" = "km";
      setImportState({
        status: "success",
        parsedTrack: parsed,
        fileName: selectedFile.name,
        totalDistanceLabel: formatDistanceKm(parsed.totalDistanceMeters),
        elapsedLabel: formatDuration(parsed.totalDurationSeconds),
        averagePaceLabel: formatPace(parsed.averagePaceSecondsPerKm),
        splits: buildExpectedSplits(parsed, unit),
        unit
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? toUserFriendlyImportErrorMessage(error.message)
          : "We could not read that file. Please choose a GPX file and try again.";
      setImportState({ status: "error", message });
    }
  };

  const onToggleUnit = (): void => {
    if (importState.status !== "success") {
      return;
    }

    const nextUnit: "km" | "mi" = importState.unit === "km" ? "mi" : "km";

    setImportState({
      ...importState,
      unit: nextUnit,
      splits: buildExpectedSplits(importState.parsedTrack, nextUnit)
    });
  };

  return (
    <ScrollView
      style={s.styles.container}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>Upload your GPX route</Text>
        <Text style={s.styles.subtitle}>Get clear expected split times for your pacing plan</Text>
        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>How it works</Text>
          <Text style={s.styles.body}>{summaryNote}</Text>
        </DSCard>

        <View style={localStyles.actionsRow}>
          <View style={localStyles.actionCell}>
            <DSButton preset="primary" onPress={() => void onImportGpx()} disabled={importState.status === "loading"}>
              {importState.status === "loading" ? "Uploading..." : "Choose GPX file"}
            </DSButton>
          </View>
          <View style={localStyles.actionCell}>
            <DSButton preset="secondary" onPress={onToggleUnit} disabled={!canToggleUnit}>
              Show splits in {activeUnit === "km" ? "miles" : "kilometers"}
            </DSButton>
          </View>
        </View>

        {importState.status === "success" ? (
          <View style={localStyles.results}>
            <Text style={s.styles.label}>Route summary</Text>
            <Text style={s.styles.body}>Total distance: {importState.totalDistanceLabel}</Text>
            <Text style={s.styles.body}>Total time: {importState.elapsedLabel}</Text>
            <Text style={s.styles.body}>Average pace: {importState.averagePaceLabel}</Text>

            <Text style={[s.styles.label, localStyles.splitHeader]}>Expected splits ({importState.unit})</Text>
            {importState.splits.length > 0 ? (
              importState.splits.map((split) => (
                <DSCard key={split.splitIndex} style={localStyles.splitRow}>
                  <Text style={s.styles.summaryTitle}>{split.distanceLabel}</Text>
                  <Text style={s.styles.body}>Expected elapsed: {split.elapsedLabel}</Text>
                </DSCard>
              ))
            ) : (
              <Text style={s.styles.body}>
                This route is shorter than one {importState.unit === "km" ? "kilometer" : "mile"}.
              </Text>
            )}
          </View>
        ) : null}
      </DSCard>
    </ScrollView>
  );
}

function toUserFriendlyImportErrorMessage(errorMessage: string): string {
  const normalized = errorMessage.toLowerCase();
  if (normalized.includes("empty")) {
    return "That file looks empty. Please choose a valid GPX export.";
  }
  if (normalized.includes("timestamps")) {
    return "This GPX file does not include timing data. Export a GPX with timestamps to see expected splits.";
  }
  if (normalized.includes("distance is zero")) {
    return "We could not detect movement in this GPX file. Please choose a route file with track points.";
  }
  if (normalized.includes("track points")) {
    return "We could not read enough route points from this file. Please choose a standard GPX track export.";
  }
  return "We could not process this GPX file. Please choose another GPX export and try again.";
}

const localStyles = StyleSheet.create({
  actionsRow: { marginTop: 12, flexDirection: "row", gap: 8 },
  actionCell: { flex: 1 },
  results: { marginTop: 16, gap: 6 },
  splitHeader: { marginTop: 10 },
  splitRow: { marginTop: 6 }
});
