import { useNavigation } from "@react-navigation/native";
import { useState, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSTextInput, useDSTheme } from "../design-system";
import type { GuestStackParamList } from "./types";

export function JoinCrewEntryScreen(): ReactElement {
  const theme = useDSTheme();
  const navigation = useNavigation<NativeStackNavigationProp<GuestStackParamList>>();
  const insets = useSafeAreaInsets();
  const [displayName, setDisplayName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const onContinue = () => {
    if (!displayName.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!/^\d{6}$/.test(roomCode.trim())) {
      setError("Enter a valid 6-digit code.");
      return;
    }
    setError(undefined);
    navigation.navigate("JoinPreview", { displayName: displayName.trim(), roomCode: roomCode.trim() });
  };

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16, backgroundColor: theme.color.background }
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={12}
        style={styles.backRow}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.backChevron}>‹</Text>
        <Text style={styles.backLabel}>Back</Text>
      </Pressable>

      <View style={styles.form}>
        <Text style={styles.title}>Join your crew</Text>
        <Text style={styles.body}>Enter your name and 6-digit code to preview the race room.</Text>
        <DSTextInput value={displayName} onChangeText={setDisplayName} placeholder="Your name" autoCapitalize="words" />
        <DSTextInput value={roomCode} onChangeText={setRoomCode} placeholder="123456" keyboardType="number-pad" maxLength={6} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={onContinue}>
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 2,
    paddingVertical: 8,
    paddingRight: 12,
    marginBottom: 8
  },
  backChevron: {
    color: "#2563eb",
    fontSize: 28,
    fontWeight: "600",
    marginTop: -2,
    lineHeight: 28
  },
  backLabel: {
    color: "#2563eb",
    fontSize: 17,
    fontWeight: "600"
  },
  form: { flex: 1, gap: 12, justifyContent: "center" },
  title: { color: "#111827", fontSize: 32, fontWeight: "800" },
  body: { color: "#5c5a54", fontSize: 16 },
  error: { color: "#b91c1c" },
  button: {
    minHeight: 54,
    borderRadius: 12,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8
  },
  buttonText: { color: "#052e16", fontWeight: "800", fontSize: 18 }
});
