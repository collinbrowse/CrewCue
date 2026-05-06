/**
 * Per-room chat notification preferences. Three options:
 *   - all: every new message
 *   - mentions: only @-mentions of this user
 *   - none: no chat notifications
 *
 * Server is source of truth. Local SecureStore cache is updated on success
 * for cold-start UX (see features/chat/notificationPrefs.ts).
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { ChatNotificationPref } from "@crewcue/contracts";
import { createApiClient } from "../api/client";
import { DSButton, DSCard, useDSTheme } from "../design-system";
import { readCachedPref, writeCachedPref } from "../features/chat/notificationPrefs";
import { useAuthedShell } from "../shell/AuthedShellContext";

const OPTIONS: { value: ChatNotificationPref; label: string; description: string }[] = [
  { value: "all", label: "All messages", description: "Notify me every time someone posts." },
  {
    value: "mentions",
    label: "Mentions only",
    description: "Notify me only when someone @ mentions me."
  },
  { value: "none", label: "None", description: "Do not send chat notifications." }
];

export function ChatNotificationPrefsScreen(): ReactElement {
  const theme = useDSTheme();
  const styles = makeStyles(theme);
  const shell = useAuthedShell();
  const room = shell.room;
  const accessToken = shell.auth.accessToken;
  const api = useMemo(
    () =>
      accessToken && room
        ? createApiClient({ baseUrl: shell.baseUrl, accessToken })
        : undefined,
    [accessToken, room, shell.baseUrl]
  );

  const [pref, setPref] = useState<ChatNotificationPref>("all");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!room || !api) return;
    (async () => {
      const cached = await readCachedPref(room.id);
      setPref(cached);
      try {
        const fresh = await api.getChatNotificationPref(room.id);
        setPref(fresh.preference);
        await writeCachedPref(room.id, fresh.preference);
      } catch {
        // network error: keep cached value
      }
    })();
  }, [room, api]);

  const handleSelect = async (next: ChatNotificationPref) => {
    if (!room || !api) return;
    if (next === pref) return;
    setBusy(true);
    const previous = pref;
    setPref(next);
    try {
      await api.setChatNotificationPref(room.id, next);
      await writeCachedPref(room.id, next);
    } catch (e) {
      setPref(previous);
      Alert.alert(
        "Could not update",
        e instanceof Error ? e.message : "Please try again."
      );
    } finally {
      setBusy(false);
    }
  };

  if (!room) {
    return (
      <View style={[styles.container, styles.center]}>
        <DSCard>
          <Text style={styles.title}>Chat notifications</Text>
          <Text style={styles.body}>Activate or join a race room to manage chat notifications.</Text>
        </DSCard>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Chat notifications</Text>
      <Text style={styles.body}>Choose how often we notify you about new chat messages.</Text>
      <View style={styles.list}>
        {OPTIONS.map((opt) => {
          const selected = opt.value === pref;
          return (
            <DSCard key={opt.value} style={selected ? styles.cardSelected : styles.card}>
              <Text style={styles.optionLabel}>{opt.label}</Text>
              <Text style={styles.body}>{opt.description}</Text>
              <View style={styles.actionRow}>
                <DSButton
                  preset={selected ? "primary" : "secondary"}
                  disabled={busy || selected}
                  onPress={() => void handleSelect(opt.value)}
                >
                  {selected ? "Selected" : "Use this"}
                </DSButton>
              </View>
            </DSCard>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useDSTheme>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.background,
      padding: theme.spacing.gutter ?? 12,
      gap: 12
    },
    center: { justifyContent: "center", alignItems: "center" },
    title: { color: theme.color.text, fontSize: 18, fontWeight: "700" },
    body: { color: theme.color.body, fontSize: 14 },
    list: { gap: 12 },
    card: { padding: 14, gap: 8 },
    cardSelected: { padding: 14, gap: 8, borderColor: theme.color.primary, borderWidth: 2 },
    optionLabel: { color: theme.color.text, fontWeight: "700", fontSize: 16 },
    actionRow: { flexDirection: "row", justifyContent: "flex-end" }
  });
}
