import { useEffect, useState, type ReactElement } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RaceRoomJoinPreview } from "@crewcue/contracts";
import { createPublicApiClient } from "../api/client";
import { useDSTheme } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { GuestStackParamList } from "./types";

export function JoinCrewPreviewScreen(): ReactElement {
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
  const s = useAuthedShell();
  const navigation = useNavigation<NativeStackNavigationProp<GuestStackParamList>>();
  const route = useRoute<RouteProp<GuestStackParamList, "JoinPreview">>();
  const { roomCode, displayName } = route.params;
  const [preview, setPreview] = useState<RaceRoomJoinPreview | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const publicClient = createPublicApiClient({ baseUrl: s.baseUrl });
        const res = await publicClient.getJoinPreviewByCode(roomCode);
        if (!cancelled) {
          setPreview(res.preview);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load race preview.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode, s.baseUrl]);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.color.background, paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
    >
      <Text style={styles.title}>Preview your crew</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {preview ? (
        <>
          <Text style={styles.roomName}>{preview.roomName}</Text>
          <Text style={styles.meta}>
            Members: {preview.memberCount}
            {typeof preview.courseDistanceMeters === "number" ? ` • ${(preview.courseDistanceMeters / 1000).toFixed(1)} km` : ""}
          </Text>
          <View style={styles.memberWrap}>
            {preview.members.map((member, index) => (
              <Text key={`${member.displayName}-${index}`} style={styles.memberRow}>
                {member.displayName} • {member.role}
              </Text>
            ))}
          </View>
          <Pressable
            style={styles.button}
            onPress={() => navigation.navigate("JoinAccount", { roomCode, displayName })}
          >
            <Text style={styles.buttonText}>This is my crew</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.meta}>Loading preview…</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, gap: 10 },
  title: { color: "#111827", fontSize: 30, fontWeight: "800" },
  roomName: { color: "#15803d", fontSize: 24, fontWeight: "800" },
  meta: { color: "#5c5a54", fontSize: 16 },
  memberWrap: { backgroundColor: "#e7e5de", borderRadius: 12, padding: 12, gap: 8, marginTop: 8 },
  memberRow: { color: "#1f2937", fontSize: 15 },
  button: { marginTop: 14, minHeight: 54, borderRadius: 12, backgroundColor: "#22c55e", alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#052e16", fontWeight: "800", fontSize: 17 },
  error: { color: "#b91c1c" }
});
