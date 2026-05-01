import { useState, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import {
  ONBOARDING_INTENT_KEY,
  ONBOARDING_NOTIFICATIONS_REQUIRED_KEY,
  ONBOARDING_NOTIFICATIONS_SEEN_KEY
} from "./onboardingState";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function OnboardingNotificationsScreen(): ReactElement {
  const s = useAuthedShell();
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const complete = async () => {
    await SecureStore.setItemAsync(ONBOARDING_NOTIFICATIONS_SEEN_KEY, "true");
    await SecureStore.setItemAsync(ONBOARDING_NOTIFICATIONS_REQUIRED_KEY, "false");
    await SecureStore.setItemAsync(ONBOARDING_INTENT_KEY, "none");
    await s.onRefreshOnboardingStage();
  };

  const onEnable = async () => {
    setBusy(true);
    try {
      const existing = await Notifications.getPermissionsAsync();
      const final = existing.status === "granted" ? existing : await Notifications.requestPermissionsAsync();
      setMessage(
        final.status === "granted"
          ? "Notifications enabled. You will get crew updates and split timing changes."
          : "Notifications skipped for now. You can enable them later in Settings."
      );
    } catch {
      setMessage("Could not update notification settings here. You can enable them later in Settings.");
    } finally {
      await complete();
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.kicker}>One last step</Text>
      <Text style={styles.title}>Enable notifications</Text>
      <Text style={styles.body}>
        Get alerts when crew members post updates or when expected split timing changes for an aid station.
      </Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Pressable style={styles.primary} onPress={() => void onEnable()} disabled={busy}>
        <Text style={styles.primaryText}>{busy ? "Updating..." : "Enable notifications"}</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => void complete()} disabled={busy}>
        <Text style={styles.secondaryText}>Not now</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#111827", padding: 20, justifyContent: "center", gap: 12 },
  kicker: { color: "#a5b4fc", fontWeight: "700", textTransform: "uppercase", fontSize: 13 },
  title: { color: "#f8fafc", fontSize: 36, fontWeight: "800" },
  body: { color: "#d1d5db", fontSize: 17, lineHeight: 24 },
  primary: { minHeight: 54, borderRadius: 12, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryText: { color: "#111827", fontSize: 18, fontWeight: "800" },
  secondary: { minHeight: 52, borderRadius: 12, backgroundColor: "#374151", alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#f3f4f6", fontWeight: "700", fontSize: 16 },
  message: { color: "#e9d5ff", backgroundColor: "rgba(76,29,149,0.35)", borderRadius: 10, padding: 10 }
});
