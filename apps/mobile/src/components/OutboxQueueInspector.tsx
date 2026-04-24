import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { OutboxOperation } from "../sync/outboxStore";

type Props = {
  styles: any;
  outbox: OutboxOperation[];
  outboxAutoProcessIntervalMs: number;
  describeOutboxOperation: (operation: OutboxOperation) => string;
  describeOutboxStatus: (status: OutboxOperation["status"]) => string;
};

export function OutboxQueueInspector({
  styles,
  outbox,
  outboxAutoProcessIntervalMs,
  describeOutboxOperation,
  describeOutboxStatus
}: Props): ReactElement {
  const counts = {
    pending: outbox.filter((entry) => entry.status === "pending").length,
    sent: outbox.filter((entry) => entry.status === "sent").length,
    rejected: outbox.filter((entry) => entry.status === "rejected").length,
    conflict: outbox.filter((entry) => entry.status === "conflict").length
  };

  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryTitle}>Outbox queue inspector</Text>
      <Text style={styles.body}>
        Auto-processing runs every {outboxAutoProcessIntervalMs / 1000}s while authenticated, the room is active,
        and the app is foregrounded.
      </Text>
      <Text style={styles.code}>
        pending {counts.pending} · sent {counts.sent} · rejected {counts.rejected} · conflict {counts.conflict}
      </Text>

      {outbox.length === 0 ? (
        <Text style={[styles.code, { color: "#6b7280" }]}>Queue is empty.</Text>
      ) : (
        [...outbox].reverse().map((operation) => (
          <View key={operation.id} style={styles.outboxItem}>
            <View style={styles.outboxItemHeader}>
              <Text style={styles.code}>{describeOutboxOperation(operation)}</Text>
              <Text
                style={[
                  styles.outboxStatus,
                  operation.status === "sent"
                    ? styles.outboxStatusSent
                    : operation.status === "rejected"
                      ? styles.outboxStatusRejected
                      : operation.status === "conflict"
                        ? styles.outboxStatusConflict
                        : styles.outboxStatusPending
                ]}
              >
                {describeOutboxStatus(operation.status)}
              </Text>
            </View>
            <Text style={styles.body}>attempts: {operation.attempts}</Text>
            {operation.feedback ? <Text style={styles.body}>{operation.feedback}</Text> : null}
            {operation.updatedAt ? <Text style={styles.code}>{operation.updatedAt}</Text> : null}
          </View>
        ))
      )}
    </View>
  );
}
