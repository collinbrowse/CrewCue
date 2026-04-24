import type { ReactElement } from "react";
import { Text, View } from "react-native";

type Props = {
  styles: any;
  pendingOutboxCount: number;
  lastError?: string;
  lastStatusMessage?: string;
  projectionStaleSeconds?: number;
};

export function OperationalStatusRail({
  styles,
  pendingOutboxCount,
  lastError,
  lastStatusMessage,
  projectionStaleSeconds
}: Props): ReactElement {
  const stale = typeof projectionStaleSeconds === "number" && projectionStaleSeconds > 120;

  return (
    <View style={styles.statusRail}>
      <Text style={styles.statusRailTitle}>Operational status</Text>
      <Text style={styles.statusRailItem}>
        Pending outbox: <Text style={styles.code}>{pendingOutboxCount}</Text>
      </Text>
      <Text style={styles.statusRailItem}>
        Projection freshness:{" "}
        <Text style={stale ? styles.errorText : styles.code}>
          {projectionStaleSeconds === undefined
            ? "unknown"
            : stale
              ? `stale (${Math.round(projectionStaleSeconds)}s)`
              : `fresh (${Math.round(projectionStaleSeconds)}s)`}
        </Text>
      </Text>
      <Text style={styles.statusRailItem}>
        Last error: <Text style={styles.errorText}>{lastError ?? "none"}</Text>
      </Text>
      <Text style={styles.statusRailItem}>
        Last status: <Text style={styles.body}>{lastStatusMessage ?? "none"}</Text>
      </Text>
    </View>
  );
}
