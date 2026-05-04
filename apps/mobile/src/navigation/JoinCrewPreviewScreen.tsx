import { useEffect, useState, type ReactElement } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RaceRoomJoinPreview } from "@crewcue/contracts";
import { createPublicApiClient } from "../api/client";
import { useDSTheme } from "../design-system";
import { DSButton } from "../design-system";
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
      <Text style={[styles.title, { color: theme.color.authHeading }]}>Preview your crew</Text>
      {error ? <Text style={[styles.error, { color: theme.color.authErrorText }]}>{error}</Text> : null}
      {preview ? (
        <>
          <Text style={[styles.roomName, { color: theme.color.authAccent }]}>{preview.roomName}</Text>
          <Text style={[styles.meta, { color: theme.color.authBody }]}>
            Members: {preview.memberCount}
            {typeof preview.courseDistanceMeters === "number" ? ` • ${(preview.courseDistanceMeters / 1000).toFixed(1)} km` : ""}
          </Text>
          <View style={[styles.memberWrap, { borderColor: theme.color.divider }]}>
            {preview.members.map((member, index) => (
              <Text key={`${member.displayName}-${index}`} style={[styles.memberRow, { color: theme.color.authHeading }]}>
                {member.displayName} • {member.role}
              </Text>
            ))}
          </View>
          <DSButton preset="authPrimary" onPress={() => navigation.navigate("JoinAccount", { roomCode, displayName })}>
            This is my crew
          </DSButton>
        </>
      ) : (
        <Text style={[styles.meta, { color: theme.color.authBody }]}>Loading preview…</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, gap: 10 },
  title: { fontSize: 30, fontWeight: "800" },
  roomName: { fontSize: 24, fontWeight: "800" },
  meta: { fontSize: 16 },
  memberWrap: { backgroundColor: "#ffffff", borderRadius: 16, borderWidth: 1, padding: 12, gap: 8, marginTop: 8 },
  memberRow: { fontSize: 15 },
  error: { fontWeight: "600" }
});
