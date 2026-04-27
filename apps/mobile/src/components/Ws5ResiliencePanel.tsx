import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type { MergeRecord, SyncQueueDiagnostics } from "@crewcue/contracts";

type Props = {
  styles: Record<string, any>;
  disableRefresh: boolean;
  disablePushDiagnostics: boolean;
  refreshDisabledHint?: string;
  pushDisabledHint?: string;
  busy: boolean;
  queueDiagnostics?: SyncQueueDiagnostics[];
  mergeRecords?: MergeRecord[];
  onRefreshTelemetry: () => void;
  onPushDiagnostics: () => void;
};

export function Ws5ResiliencePanel({
  styles,
  disableRefresh,
  disablePushDiagnostics,
  refreshDisabledHint,
  pushDisabledHint,
  busy,
  queueDiagnostics,
  mergeRecords,
  onRefreshTelemetry,
  onPushDiagnostics
}: Props): ReactElement {
  const diag = queueDiagnostics ?? [];
  const merges = mergeRecords ?? [];
  const recentDiag = [...diag].reverse().slice(0, 8);
  const recentMerges = [...merges].reverse().slice(0, 8);

  return (
    <View style={[styles.summaryCard, { marginTop: 16 }]}>
      <Text style={styles.summaryTitle}>WS5 sync telemetry</Text>
      <Text style={styles.body}>
        Queue diagnostics and merge records are operator-visible telemetry (see merge-concurrency-policy). Refresh pulls
        health, diagnostics, and merge history for this room.
      </Text>
      {disableRefresh && refreshDisabledHint ? (
        <Text style={[styles.body, { color: "#9ca3af" }]}>{refreshDisabledHint}</Text>
      ) : null}
      {disablePushDiagnostics && pushDisabledHint ? (
        <Text style={[styles.body, { color: "#9ca3af" }]}>{pushDisabledHint}</Text>
      ) : null}
      <View style={{ marginTop: 10, gap: 8 }}>
        <Pressable
          style={styles.secondaryButton}
          onPress={onRefreshTelemetry}
          disabled={disableRefresh || busy}
        >
          <Text style={styles.secondaryButtonLabel}>{busy ? "…" : "Refresh WS5 telemetry"}</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={onPushDiagnostics}
          disabled={disablePushDiagnostics || busy}
        >
          <Text style={styles.secondaryButtonLabel}>Push outbox pending counts</Text>
        </Pressable>
      </View>
      <Text style={[styles.label, { marginTop: 14 }]}>Queue diagnostics (recent)</Text>
      {recentDiag.length === 0 ? (
        <Text style={[styles.code, { color: "#6b7280" }]}>None yet. Push a snapshot after pending items exist.</Text>
      ) : (
        recentDiag.map((row) => (
          <View key={row.id} style={styles.visitRow}>
            <Text style={styles.code}>
              {row.reportedAt.slice(11, 19)}Z · {row.deviceId}
            </Text>
            <Text style={styles.body}>{JSON.stringify(row.pendingByOpType)}</Text>
          </View>
        ))
      )}
      <Text style={[styles.label, { marginTop: 14 }]}>Merge records (recent)</Text>
      {recentMerges.length === 0 ? (
        <Text style={[styles.code, { color: "#6b7280" }]}>None yet. Log from a conflict row in the outbox inspector.</Text>
      ) : (
        recentMerges.map((row) => (
          <View key={row.id} style={styles.visitRow}>
            <Text style={styles.code}>
              {row.recordedAt.slice(11, 19)}Z · {row.strategy}
            </Text>
            <Text style={styles.body}>{row.conflictKey}</Text>
            {row.notes ? <Text style={[styles.code, { color: "#9ca3af" }]}>{row.notes}</Text> : null}
          </View>
        ))
      )}
    </View>
  );
}
