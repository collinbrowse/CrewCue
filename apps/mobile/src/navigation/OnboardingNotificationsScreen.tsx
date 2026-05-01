import { useState, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ONBOARDING_INTENT_KEY,
  ONBOARDING_NOTIFICATIONS_REQUIRED_KEY,
  ONBOARDING_NOTIFICATIONS_SEEN_KEY
} from "./onboardingState";
import { useDSTheme } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function OnboardingNotificationsScreen(): ReactElement {
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
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
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          backgroundColor: theme.color.background
        }
      ]}
    >
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
  root: { flex: 1, paddingHorizontal: 20, justifyContent: "center", gap: 12 },
  kicker: { color: "#6B46C1", fontWeight: "700", textTransform: "uppercase", fontSize: 13 },
  title: { color: "#111827", fontSize: 36, fontWeight: "800" },
  body: { color: "#5c5a54", fontSize: 17, lineHeight: 24 },
  primary: { minHeight: 54, borderRadius: 12, backgroundColor: "#6B46C1", alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryText: { color: "#ffffff", fontSize: 18, fontWeight: "800" },
  secondary: { minHeight: 52, borderRadius: 12, backgroundColor: "#e7e5de", alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#1f2937", fontWeight: "700", fontSize: 16 },
  message: { color: "#4c1d95", backgroundColor: "rgba(107,70,193,0.12)", borderRadius: 10, padding: 10 }
});
