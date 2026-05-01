import { useNavigation } from "@react-navigation/native";
import { useState, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { GuestStackParamList } from "./types";
import { DSTextInput } from "../design-system";

export function JoinCrewEntryScreen(): ReactElement {
  const navigation = useNavigation<NativeStackNavigationProp<GuestStackParamList>>();
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
    <View style={styles.root}>
      <Text style={styles.title}>Join your crew</Text>
      <Text style={styles.body}>Enter your name and 6-digit code to preview the race room.</Text>
      <DSTextInput value={displayName} onChangeText={setDisplayName} placeholder="Your name" autoCapitalize="words" />
      <DSTextInput value={roomCode} onChangeText={setRoomCode} placeholder="123456" keyboardType="number-pad" maxLength={6} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={onContinue}>
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1020", padding: 20, gap: 12, justifyContent: "center" },
  title: { color: "#f8fafc", fontSize: 32, fontWeight: "800" },
  body: { color: "#cbd5e1", fontSize: 16 },
  error: { color: "#fecaca" },
  button: { minHeight: 54, borderRadius: 12, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center", marginTop: 8 },
  buttonText: { color: "#052e16", fontWeight: "800", fontSize: 18 }
});
