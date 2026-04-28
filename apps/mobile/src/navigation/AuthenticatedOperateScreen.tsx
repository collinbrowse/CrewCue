import type { ReactElement } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScrollView, Text, View } from "react-native";
import { AuthenticatedActionPanel } from "../components/AuthenticatedActionPanel";
import { MobileShellSessionHeader } from "../components/MobileShellSessionHeader";
import { OperationalSummarySections } from "../components/OperationalSummarySections";
import { OperationalStatusRail } from "../components/OperationalStatusRail";
import { OutboxQueueInspector } from "../components/OutboxQueueInspector";
import { DSButton, DSCard } from "../design-system";
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
      style={s.styles.container}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>CrewCue</Text>
        <Text style={s.styles.subtitle}>Race operations control center</Text>
        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>Next priority</Text>
          <Text style={s.styles.body}>
            1) Keep sync fresh, 2) resolve outbox conflicts/rejections, 3) run checkpoint and incident actions.
          </Text>
        </DSCard>

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
          <View style={{ flex: 1 }}>
            <DSButton preset="secondary" onPress={() => navigation.navigate("OperateStatus")}>
              Status Detail
            </DSButton>
          </View>
          <View style={{ flex: 1 }}>
            <DSButton preset="secondary" onPress={() => navigation.navigate("OperateOutbox")}>
              Outbox Detail
            </DSButton>
          </View>
        </View>

        <OperationalStatusRail
          styles={s.styles}
          pendingOutboxCount={s.pendingOutboxCount}
          lastError={s.apiError}
          lastStatusMessage={s.syncStatusMessage}
          projectionStaleSeconds={s.projection?.secondsSinceLastAcceptedPing}
        />

        <OperationalSummarySections variant="phase1-part-a" {...phase1ReadoutProps} />

        <Text style={[s.styles.label, { marginTop: 16 }]}>Action center</Text>
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

        <Text style={[s.styles.label, { marginTop: 16 }]}>Queue recovery</Text>
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

        <OperationalSummarySections variant="phase1-part-b" {...phase1ReadoutProps} />
      </DSCard>
    </ScrollView>
  );
}
