import { useMemo, type ReactElement } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { DSButton, DSCard, useDSTheme, type DSThemeTokens } from "../../design-system";
import type { StravaConnectionState } from "./useStravaConnection";

export type StravaConnectionCardProps = {
  strava: StravaConnectionState;
  /** When false, hide actions (no API client / not signed in). */
  enabled?: boolean;
};

/**
 * Profile / cold-start surface for Connect Strava → sync activity history (W3-2).
 */
export function StravaConnectionCard(props: StravaConnectionCardProps): ReactElement {
  const theme = useDSTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { strava } = props;
  const enabled = props.enabled !== false;

  return (
    <View accessibilityLabel="Strava connection">
      <DSCard style={styles.card}>
      <Text style={styles.title} accessibilityLabel="Strava connection title">
        Strava activity history
      </Text>
      <Text style={styles.body} accessibilityLabel="Strava connection explanation">
        Sync your last year of Strava runs (all distances; rides and other sports are skipped). Those
        runs are used to build your pacing estimates. Secrets stay on the API; this app only opens
        Strava consent.
      </Text>
      {strava.loading ? (
        <ActivityIndicator accessibilityLabel="Loading Strava connection" color={theme.color.text} />
      ) : (
        <Text style={styles.status} accessibilityLabel="Strava connection status">
          {strava.connected
            ? `Connected${strava.athleteId ? ` · athlete ${strava.athleteId}` : ""}`
            : "Not connected"}
        </Text>
      )}
      {strava.lastSyncMessage ? (
        <Text style={styles.meta} accessibilityLabel="Strava sync result">
          {strava.lastSyncMessage}
        </Text>
      ) : null}
      {strava.error ? (
        <Text style={styles.error} accessibilityLabel="Strava connection error">
          {strava.error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {!strava.connected ? (
          <DSButton
            preset="primary"
            onPress={() => void strava.connect()}
            disabled={!enabled || strava.busy || strava.loading}
          >
            {strava.busy ? "Connecting…" : "Connect Strava"}
          </DSButton>
        ) : (
          <>
            <DSButton
              preset="secondary"
              onPress={() => void strava.sync()}
              disabled={!enabled || strava.busy}
            >
              {strava.busy ? "Working…" : "Sync activities"}
            </DSButton>
            <DSButton
              preset="danger"
              onPress={() => void strava.disconnect()}
              disabled={!enabled || strava.busy}
            >
              Disconnect
            </DSButton>
          </>
        )}
      </View>
      </DSCard>
    </View>
  );
}

function createStyles(theme: DSThemeTokens) {
  return StyleSheet.create({
    card: {
      gap: 8
    },
    title: {
      color: theme.color.text,
      fontSize: 17,
      fontWeight: "600"
    },
    body: {
      color: theme.color.body,
      fontSize: 14,
      lineHeight: 20
    },
    status: {
      color: theme.color.text,
      fontSize: 14,
      fontWeight: "500"
    },
    meta: {
      color: theme.color.body,
      fontSize: 13
    },
    error: {
      color: theme.color.danger,
      fontSize: 13
    },
    actions: {
      gap: 8,
      marginTop: 4
    }
  });
}
