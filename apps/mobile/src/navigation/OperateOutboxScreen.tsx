import type { ReactElement } from "react";
import { ScrollView, Text } from "react-native";
import { OutboxQueueInspector } from "../components/OutboxQueueInspector";
import { DSCard } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function OperateOutboxScreen(): ReactElement {
  const s = useAuthedShell();

  return (
    <ScrollView style={s.styles.container} contentContainerStyle={s.styles.scroll}>
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>Outbox Detail</Text>
        <Text style={s.styles.subtitle}>Queue health, retries, conflicts, and operator hints</Text>
        <OutboxQueueInspector
          styles={s.styles}
          outbox={s.outbox}
          outboxAutoProcessIntervalMs={s.outboxAutoProcessIntervalMs}
          describeOutboxOperation={s.describeOutboxOperation}
          describeOutboxStatus={s.describeOutboxStatus}
          onRetryOutboxOperationSafely={(operationId) => {
            void s.onRetryOutboxOperationSafely(operationId);
          }}
          canLogMergeTelemetry={s.canLogMergeTelemetry}
          onRecordOutboxMergeTelemetry={(operationId) => {
            void s.onRecordOutboxMergeTelemetry(operationId);
          }}
        />
      </DSCard>
    </ScrollView>
  );
}
