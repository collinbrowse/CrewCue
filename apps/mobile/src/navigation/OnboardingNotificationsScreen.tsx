import { useState, type ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getPermissionsAsync, requestPermissionsAsync } from "../platform/expoNotificationsShim";
import * as SecureStore from "../storage/secureStorage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ONBOARDING_INTENT_KEY,
  ONBOARDING_NOTIFICATIONS_REQUIRED_KEY,
  ONBOARDING_NOTIFICATIONS_SEEN_KEY
} from "./onboardingState";
import { DSButton, useDSTheme } from "../design-system";
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
      const existing = await getPermissionsAsync();
      const final = existing.status === "granted" ? existing : await requestPermissionsAsync();
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
      <Text style={[styles.kicker, { color: theme.color.authAccent }]}>One last step</Text>
      <Text style={[styles.title, { color: theme.color.authHeading }]}>Enable notifications</Text>
      <Text style={[styles.body, { color: theme.color.authBody }]}>
        Get alerts when crew members post updates or when expected split timing changes for an aid station.
      </Text>
      {message ? <Text style={[styles.message, { color: theme.color.authAccent }]}>{message}</Text> : null}
      <DSButton preset="authPrimary" onPress={() => void onEnable()} disabled={busy}>
        {busy ? "Updating..." : "Enable notifications"}
      </DSButton>
      <DSButton preset="authSecondary" onPress={() => void complete()} disabled={busy}>
        Not now
      </DSButton>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, justifyContent: "center", gap: 12 },
  kicker: { fontWeight: "700", textTransform: "uppercase", fontSize: 13 },
  title: { fontSize: 36, fontWeight: "800" },
  body: { fontSize: 17, lineHeight: 24 },
  message: { backgroundColor: "rgba(107,70,193,0.12)", borderRadius: 10, padding: 10 }
});
