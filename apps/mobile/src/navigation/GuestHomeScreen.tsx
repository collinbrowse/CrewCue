import type { ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { OperationalSummarySections } from "../components/OperationalSummarySections";
import { MobileShellSessionHeader } from "../components/MobileShellSessionHeader";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function GuestHomeScreen(): ReactElement {
  const s = useAuthedShell();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#0f172a" }}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.styles.card}>
        <Text style={s.styles.title}>CrewCue</Text>
        <Text style={s.styles.subtitle}>Crew operations</Text>

        <MobileShellSessionHeader
          styles={s.styles}
          baseUrl={s.baseUrl}
          redirectUri={s.auth.redirectUri}
          authStatus={s.auth.status}
          claims={s.auth.claims}
          authError={s.auth.error}
          pendingOutboxCount={s.pendingOutboxCount}
          outboxTotal={s.outbox.length}
          appState={s.appState}
        />

        <View style={{ marginTop: 16, gap: 8 }}>
          <Pressable
            style={s.styles.primaryButton}
            onPress={s.auth.signIn}
            disabled={s.auth.status === "authenticating"}
          >
            <Text style={s.styles.primaryButtonLabel}>
              {s.auth.status === "authenticating" ? "Opening Auth0..." : "Sign in with Auth0"}
            </Text>
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
