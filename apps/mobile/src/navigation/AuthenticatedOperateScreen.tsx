import type { ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { AuthenticatedActionPanel } from "../components/AuthenticatedActionPanel";
import { MobileShellSessionHeader } from "../components/MobileShellSessionHeader";
import { OperationalStatusRail } from "../components/OperationalStatusRail";
import { OutboxQueueInspector } from "../components/OutboxQueueInspector";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function AuthenticatedOperateScreen(): ReactElement {
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

        <OperationalStatusRail
          styles={s.styles}
          pendingOutboxCount={s.pendingOutboxCount}
          lastError={s.apiError}
          lastStatusMessage={s.syncStatusMessage}
          projectionStaleSeconds={s.projection?.secondsSinceLastAcceptedPing}
        />

        <OutboxQueueInspector
          styles={s.styles}
          outbox={s.outbox}
          outboxAutoProcessIntervalMs={s.outboxAutoProcessIntervalMs}
          describeOutboxOperation={s.describeOutboxOperation}
          describeOutboxStatus={s.describeOutboxStatus}
        />

        <View style={{ marginTop: 16, gap: 8 }}>
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
      </View>
    </ScrollView>
  );
}
