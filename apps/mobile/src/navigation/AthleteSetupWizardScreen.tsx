import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { DSTextInput } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import { buildExpectedSplits, buildRaceCourseFromGpx, parseCourseTrack, type ParsedGpxTrack } from "../features/gpx/gpxImport";
import { createApiClient } from "../api/client";
import { ONBOARDING_INTENT_KEY } from "./onboardingState";

export function AthleteSetupWizardScreen(): ReactElement {
  const s = useAuthedShell();
  const [page, setPage] = useState(0);
  const [name, setName] = useState("");
  const [raceName, setRaceName] = useState("");
  const [parsed, setParsed] = useState<ParsedGpxTrack | undefined>(undefined);
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const onPick = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: false, copyToCacheDirectory: true });
    if (result.canceled) return;
    const selected = result.assets[0];
    const raw = await FileSystemLegacy.readAsStringAsync(selected.uri);
    const parsedTrack = parseCourseTrack(raw, selected.name);
    setParsed(parsedTrack);
    setFileName(selected.name);
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
      if (parsed) {
        const { course, plannedPaceSecondsPerKm } = buildRaceCourseFromGpx(parsed);
        const client = createApiClient({ baseUrl: s.baseUrl, accessToken: s.auth.accessToken });
        const updatedRoom = await client.updateRaceCourse(room.id, {
          course,
          plannedPaceSecondsPerKm,
          courseDistanceMeters: parsed.totalDistanceMeters,
          courseFileName: fileName
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

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Athlete setup</Text>
      {page === 0 ? (
        <View style={styles.page}>
          <Text style={styles.heading}>Page 1: Your name</Text>
          <DSTextInput value={name} onChangeText={setName} placeholder="Taylor Smith" autoCapitalize="words" />
        </View>
      ) : null}
      {page === 1 ? (
        <View style={styles.page}>
          <Text style={styles.heading}>Page 2: Race and GPX</Text>
          <DSTextInput value={raceName} onChangeText={setRaceName} placeholder="Silverton 100" autoCapitalize="words" />
          <Pressable style={styles.secondaryButton} onPress={() => void onPick()}>
            <Text style={styles.secondaryText}>{fileName ? `Selected: ${fileName}` : "Upload GPX / route file"}</Text>
          </Pressable>
        </View>
      ) : null}
      {page === 2 ? (
        <View style={styles.page}>
          <Text style={styles.heading}>Page 3: Splits preview</Text>
          {splits.length ? splits.map((split) => <Text key={split.splitIndex} style={styles.splitRow}>{split.distanceLabel} • {split.elapsedLabel}</Text>) : <Text style={styles.body}>Upload a route file to compute expected splits.</Text>}
          <Pressable style={styles.primaryButton} onPress={() => void onFinish()} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? "Finishing..." : "Looks good"}</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.navRow}>
        <Pressable style={styles.secondaryButton} disabled={page === 0} onPress={() => setPage((v) => Math.max(0, v - 1))}>
          <Text style={styles.secondaryText}>Back</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} disabled={page === 2} onPress={() => setPage((v) => Math.min(2, v + 1))}>
          <Text style={styles.primaryText}>Next</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#030712" },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  title: { color: "#f8fafc", fontSize: 34, fontWeight: "800" },
  heading: { color: "#93c5fd", fontSize: 20, fontWeight: "700", marginBottom: 8 },
  page: { gap: 10 },
  body: { color: "#d1d5db", fontSize: 15 },
  splitRow: { color: "#e5e7eb", fontSize: 15, paddingVertical: 2 },
  navRow: { marginTop: 8, flexDirection: "row", gap: 10 },
  primaryButton: { flex: 1, minHeight: 52, borderRadius: 10, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#052e16", fontWeight: "800", fontSize: 17 },
  secondaryButton: { flex: 1, minHeight: 52, borderRadius: 10, backgroundColor: "#1f2937", alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#e5e7eb", fontWeight: "700", fontSize: 16, paddingHorizontal: 10, textAlign: "center" },
  error: { color: "#fecaca" }
});
