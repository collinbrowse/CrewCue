import type { ReactElement } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScrollView, Text, View } from "react-native";
import { OperationalSummarySections } from "../components/OperationalSummarySections";
import { DSButton, DSCard } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { ReadoutsStackParamList } from "./types";

export function AuthenticatedReadoutsScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<NativeStackNavigationProp<ReadoutsStackParamList, "ReadoutsHome">>();

  return (
    <ScrollView
      style={s.styles.container}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>Readouts</Text>
        <Text style={s.styles.subtitle}>Projection, timeline, incidents, and adaptive context</Text>
        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>Decision focus</Text>
          <Text style={s.styles.body}>
            Prioritize stale sync alerts, new incidents, and pending recommendations before scanning deeper readouts.
          </Text>
        </DSCard>

        <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <DSButton preset="secondary" onPress={() => navigation.navigate("ReadoutsIncidents")}>
              Incident Feed Detail
            </DSButton>
          </View>
          <View style={{ flex: 1 }}>
            <DSButton preset="primary" onPress={() => navigation.navigate("GpxImport")}>
              GPX Import + Splits
            </DSButton>
          </View>
        </View>

        <OperationalSummarySections
          styles={s.styles}
          room={s.room}
          roomDetail={s.roomDetail}
          lastPing={s.lastPing}
          syncHealth={s.syncHealth}
          projection={s.projection}
          projectionPolledAt={s.projectionPolledAt}
          lastProtocolNote={s.lastProtocolNote}
          timeline={s.timeline}
          incidents={s.incidents}
          latestRecommendation={s.latestRecommendation}
          latestExplainability={s.latestExplainability}
          planDelta={s.planDelta}
          taskBoard={s.taskBoard}
          onToggleResolvedSource={s.onToggleResolvedSource}
          canToggleResolvedSource={s.canUseCheckpointControls}
          onEnqueueTaskAction={s.onEnqueueTaskAction}
          canMutateTasks={Boolean(s.room?.status === "active" && s.canEditTasks && !s.busy)}
          taskAssigneeUserId={s.auth.claims?.sub}
          taskAssigneeRole={s.currentRoomRole}
        />
      </DSCard>
    </ScrollView>
  );
}
