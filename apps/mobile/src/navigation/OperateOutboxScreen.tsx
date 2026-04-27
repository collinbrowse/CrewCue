import type { ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { OutboxQueueInspector } from "../components/OutboxQueueInspector";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function OperateOutboxScreen(): ReactElement {
  const s = useAuthedShell();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#0f172a" }} contentContainerStyle={s.styles.scroll}>
      <View style={s.styles.card}>
        <Text style={s.styles.title}>Outbox Detail</Text>
        <Text style={s.styles.subtitle}>Queue health, retries, conflicts, and operator hints</Text>
        <OutboxQueueInspector
          styles={s.styles}
          outbox={s.outbox}
          outboxAutoProcessIntervalMs={s.outboxAutoProcessIntervalMs}
          describeOutboxOperation={s.describeOutboxOperation}
          describeOutboxStatus={s.describeOutboxStatus}
        />
      </View>
    </ScrollView>
  );
}
