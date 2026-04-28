import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { DSButton } from "../design-system";
import { isSafeOutboxRetryCandidate } from "../sync/outboxPolicy";
import type { OutboxOperation } from "../sync/outboxStore";

type Props = {
  styles: any;
  outbox: OutboxOperation[];
  outboxAutoProcessIntervalMs: number;
  describeOutboxOperation: (operation: OutboxOperation) => string;
  describeOutboxStatus: (status: OutboxOperation["status"]) => string;
  onRetryOutboxOperationSafely?: (operationId: string) => void;
  canLogMergeTelemetry?: boolean;
  onRecordOutboxMergeTelemetry?: (operationId: string) => void;
};

export function OutboxQueueInspector({
  styles,
  outbox,
  outboxAutoProcessIntervalMs,
  describeOutboxOperation,
  describeOutboxStatus,
  onRetryOutboxOperationSafely,
  canLogMergeTelemetry,
  onRecordOutboxMergeTelemetry
}: Props): ReactElement {
  const counts = {
    pending: outbox.filter((entry) => entry.status === "pending").length,
    sent: outbox.filter((entry) => entry.status === "sent").length,
    rejected: outbox.filter((entry) => entry.status === "rejected").length,
    conflict: outbox.filter((entry) => entry.status === "conflict").length
  };
  const needsAttention = counts.conflict + counts.rejected;

  const getRecoveryHint = (operation: OutboxOperation): string | undefined => {
    if (operation.status === "conflict") {
      return "Conflict: refresh room/projection, confirm latest state, then retry Process Outbox. You can log merge telemetry for audit when your role allows.";
    }
    if (operation.status === "rejected") {
      return "Rejected: update input data for this operation, then enqueue and process again.";
    }
    if (operation.status === "pending" && operation.attempts > 0) {
      return "Pending retry: check connectivity and keep app foregrounded for auto-process.";
    }
    return undefined;
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
      {needsAttention > 0 ? (
        <Text style={styles.errorText}>
          {needsAttention} item(s) need operator attention (conflict/rejected).
        </Text>
      ) : null}

      {outbox.length === 0 ? (
        <Text style={[styles.code, styles.mutedText]}>Queue is empty.</Text>
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
            {getRecoveryHint(operation) ? (
              <Text
                style={[
                  styles.body,
                  operation.status === "conflict" || operation.status === "rejected"
                    ? styles.errorText
                    : styles.mutedText
                ]}
              >
                {getRecoveryHint(operation)}
              </Text>
            ) : null}
            {operation.updatedAt ? <Text style={styles.code}>{operation.updatedAt}</Text> : null}
            {isSafeOutboxRetryCandidate(operation) && onRetryOutboxOperationSafely ? (
              <Text style={styles.body}>
                Safe retry available for ping operations; task/checkpoint retries stay in global queue processing.
              </Text>
            ) : null}
            {isSafeOutboxRetryCandidate(operation) && onRetryOutboxOperationSafely ? (
              <DSButton preset="secondary" onPress={() => onRetryOutboxOperationSafely(operation.id)}>
                Retry this operation safely
              </DSButton>
            ) : null}
            {operation.status === "conflict" && canLogMergeTelemetry && onRecordOutboxMergeTelemetry ? (
              <View style={{ marginTop: 8 }}>
                <DSButton
                  preset="secondary"
                  onPress={() => {
                    void onRecordOutboxMergeTelemetry(operation.id);
                  }}
                >
                  Log merge telemetry (manual)
                </DSButton>
              </View>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}
