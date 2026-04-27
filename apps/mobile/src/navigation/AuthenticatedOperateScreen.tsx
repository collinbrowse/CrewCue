import type { ReactElement } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pressable, ScrollView, Text, View } from "react-native";
import { AuthenticatedActionPanel } from "../components/AuthenticatedActionPanel";
import { MobileShellSessionHeader } from "../components/MobileShellSessionHeader";
import { OperationalSummarySections } from "../components/OperationalSummarySections";
import { OperationalStatusRail } from "../components/OperationalStatusRail";
import { OutboxQueueInspector } from "../components/OutboxQueueInspector";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { OperateStackParamList } from "./types";

export function AuthenticatedOperateScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<NativeStackNavigationProp<OperateStackParamList, "OperateHome">>();

  const phase1ReadoutProps = {
    styles: s.styles,
    room: s.room,
    roomDetail: s.roomDetail,
    lastPing: s.lastPing,
    syncHealth: s.syncHealth,
    projection: s.projection,
    projectionPolledAt: s.projectionPolledAt,
    lastProtocolNote: s.lastProtocolNote,
    timeline: s.timeline,
    incidents: s.incidents,
    latestRecommendation: s.latestRecommendation,
    latestExplainability: s.latestExplainability,
    planDelta: s.planDelta,
    taskBoard: s.taskBoard,
    onToggleResolvedSource: s.onToggleResolvedSource,
    canToggleResolvedSource: s.canUseCheckpointControls,
    onEnqueueTaskAction: s.onEnqueueTaskAction,
    canMutateTasks: Boolean(s.room?.status === "active" && s.canEditTasks && !s.busy),
    taskAssigneeUserId: s.auth.claims?.sub,
    taskAssigneeRole: s.currentRoomRole
  } as const;

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

        <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
          <Pressable style={[s.styles.secondaryButton, { flex: 1 }]} onPress={() => navigation.navigate("OperateStatus")}>
            <Text style={s.styles.secondaryButtonLabel}>Status Detail</Text>
          </Pressable>
          <Pressable style={[s.styles.secondaryButton, { flex: 1 }]} onPress={() => navigation.navigate("OperateOutbox")}>
            <Text style={s.styles.secondaryButtonLabel}>Outbox Detail</Text>
          </Pressable>
        </View>

        <OperationalStatusRail
          styles={s.styles}
          pendingOutboxCount={s.pendingOutboxCount}
          lastError={s.apiError}
          lastStatusMessage={s.syncStatusMessage}
          projectionStaleSeconds={s.projection?.secondsSinceLastAcceptedPing}
        />

        <OperationalSummarySections variant="phase1-part-a" {...phase1ReadoutProps} />

        <Text style={[s.styles.label, { marginTop: 16 }]}>Checkpoints and room actions</Text>
        <View style={{ marginTop: 8, gap: 8 }}>
          <AuthenticatedActionPanel
            styles={s.styles}
            busy={s.busy}
            outboxProcessing={s.outboxProcessing}
            room={s.room}
            hasProjection={Boolean(s.projection)}
            projectionPollEnabled={s.projectionPollEnabled}
            incidents={s.incidents}
            latestRecommendation={s.latestRecommendation}
            stationArrivalAt={s.stationArrivalAt}
            canEditCheckpointStops={s.canEditCheckpointStops}
            canUseCheckpointControls={s.canUseCheckpointControls}
            onCreateRoom={s.onCreateRoom}
            onProcessOutbox={s.onProcessOutbox}
            onMarkEntitlementPaid={s.onMarkEntitlementPaid}
            onFetchRoomDetails={s.onFetchRoomDetails}
            onActivateRoom={s.onActivateRoom}
            onSendPing={s.onSendPing}
            onPostSyncHeartbeat={s.onPostSyncHeartbeat}
            onFetchSyncHealth={s.onFetchSyncHealth}
            onFetchProjection={s.onFetchProjection}
            onToggleProjectionPoll={s.onToggleProjectionPoll}
            onFetchTaskBoard={s.onFetchTaskBoard}
            onPostProtocolNote={s.onPostProtocolNote}
            onFetchTimeline={s.onFetchTimeline}
            onPostIncident={s.onPostIncident}
            onFetchIncidents={s.onFetchIncidents}
            onGenerateRecommendation={s.onGenerateRecommendation}
            onAcceptRecommendation={s.onAcceptRecommendation}
            onRejectRecommendation={s.onRejectRecommendation}
            onRecordStationArrival={s.onRecordStationArrival}
            onEnqueueManualStop={s.onEnqueueManualStop}
            onSignOut={s.onSignOut}
          />
        </View>

        <Text style={[s.styles.label, { marginTop: 16 }]}>Outbox</Text>
        <OutboxQueueInspector
          styles={s.styles}
          outbox={s.outbox}
          outboxAutoProcessIntervalMs={s.outboxAutoProcessIntervalMs}
          describeOutboxOperation={s.describeOutboxOperation}
          describeOutboxStatus={s.describeOutboxStatus}
          onRetryOutboxOperationSafely={(operationId) => {
            void s.onRetryOutboxOperationSafely(operationId);
          }}
        />

        <OperationalSummarySections variant="phase1-part-b" {...phase1ReadoutProps} />
      </View>
    </ScrollView>
  );
}
