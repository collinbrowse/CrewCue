import type { ReactElement } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pressable, ScrollView, Text, View } from "react-native";
import { OperationalSummarySections } from "../components/OperationalSummarySections";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { ReadoutsStackParamList } from "./types";

export function AuthenticatedReadoutsScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<NativeStackNavigationProp<ReadoutsStackParamList, "ReadoutsHome">>();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#0f172a" }}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.styles.card}>
        <Text style={s.styles.title}>Readouts</Text>
        <Text style={s.styles.subtitle}>Projection, timeline, tasks, and WS4 depth</Text>

        <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
          <Pressable
            style={[s.styles.secondaryButton, { flex: 1 }]}
            onPress={() => navigation.navigate("ReadoutsIncidents")}
          >
            <Text style={s.styles.secondaryButtonLabel}>Incident Feed Detail</Text>
          </Pressable>
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
      </View>
    </ScrollView>
  );
}
