import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { IncidentEvent, RaceRoom, Recommendation } from "@crewcue/contracts";
import { DSButton, DSCard } from "../design-system";

type Props = {
  styles: any;
  busy: boolean;
  outboxProcessing: boolean;
  room?: RaceRoom;
  hasProjection: boolean;
  projectionPollEnabled: boolean;
  incidents?: IncidentEvent[];
  latestRecommendation?: Recommendation;
  stationArrivalAt: Record<string, string>;
  canEditCheckpointStops: boolean;
  canUseCheckpointControls: boolean;
  onCreateRoom: () => void;
  onProcessOutbox: () => void;
  onMarkEntitlementPaid: () => void;
  onFetchRoomDetails: (roomId?: string) => void | Promise<void>;
  onActivateRoom: () => void;
  onSendPing: () => void;
  onPostSyncHeartbeat: () => void;
  onFetchSyncHealth: () => void;
  onFetchProjection: () => void;
  onToggleProjectionPoll: () => void;
  onFetchTaskBoard: () => void;
  onPostProtocolNote: () => void;
  onFetchTimeline: () => void;
  onPostIncident: () => void;
  onFetchIncidents: () => void;
  onGenerateRecommendation: () => void;
  onAcceptRecommendation: () => void;
  onRejectRecommendation: () => void;
  onRecordStationArrival: (checkpointId: string) => void;
  onEnqueueManualStop: (checkpointId: string, arrivalAt: string) => void;
  onSignOut: () => void;
};

export function AuthenticatedActionPanel({
  styles,
  busy,
  outboxProcessing,
  room,
  hasProjection,
  projectionPollEnabled,
  incidents,
  latestRecommendation,
  stationArrivalAt,
  canEditCheckpointStops,
  canUseCheckpointControls,
  onCreateRoom,
  onProcessOutbox,
  onMarkEntitlementPaid,
  onFetchRoomDetails,
  onActivateRoom,
  onSendPing,
  onPostSyncHeartbeat,
  onFetchSyncHealth,
  onFetchProjection,
  onToggleProjectionPoll,
  onFetchTaskBoard,
  onPostProtocolNote,
  onFetchTimeline,
  onPostIncident,
  onFetchIncidents,
  onGenerateRecommendation,
  onAcceptRecommendation,
  onRejectRecommendation,
  onRecordStationArrival,
  onEnqueueManualStop,
  onSignOut
}: Props): ReactElement {
  const roomInactive = room?.status !== "active";
  const noIncidents = !incidents || incidents.length === 0;
  const recommendationPending = latestRecommendation?.status === "pending";

  return (
    <>
      <DSCard style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Session setup</Text>
        <DSButton preset="primary" onPress={onCreateRoom} disabled={busy}>
          {busy ? "Working..." : "Create race room"}
        </DSButton>
        <DSButton preset="secondary" onPress={onProcessOutbox} disabled={busy || outboxProcessing}>
          {outboxProcessing ? "Processing..." : "Process queue"}
        </DSButton>
      </DSCard>
      {room ? (
        <>
          <DSCard style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Room lifecycle</Text>
            <DSButton
              preset="secondary"
              onPress={onMarkEntitlementPaid}
              disabled={busy || room.entitlement.status === "paid"}
            >
              {room.entitlement.status === "paid" ? "Entitlement already paid" : "Mark entitlement paid"}
            </DSButton>
            <DSButton preset="secondary" onPress={onFetchRoomDetails} disabled={busy}>
              Refresh room details
            </DSButton>
            {room.entitlement.status === "paid" && room.status === "draft" ? (
              <DSButton preset="primary" onPress={onActivateRoom} disabled={busy}>
                {busy ? "Working..." : "Activate room"}
              </DSButton>
            ) : null}
          </DSCard>
          {room.status === "active" ? (
            <>
              <DSCard style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Live operations</Text>
                <DSButton preset="primary" onPress={onSendPing} disabled={busy}>
                  {busy ? "Sending..." : "Send ping"}
                </DSButton>
                <DSButton preset="primary" onPress={onPostSyncHeartbeat} disabled={busy}>
                  {busy ? "Sending..." : "Send sync heartbeat"}
                </DSButton>
                <DSButton preset="secondary" onPress={onFetchSyncHealth} disabled={busy}>
                  Refresh sync health
                </DSButton>
                <DSButton preset="secondary" onPress={onFetchProjection} disabled={busy}>
                  Refresh projection
                </DSButton>
                <DSButton preset="secondary" onPress={onToggleProjectionPoll} disabled={busy}>
                  {projectionPollEnabled ? "Auto-refresh projection: ON (8s)" : "Auto-refresh projection: OFF"}
                </DSButton>
                <DSButton preset="secondary" onPress={onFetchTaskBoard} disabled={busy}>
                  Refresh task board
                </DSButton>
                <DSButton preset="secondary" onPress={onPostProtocolNote} disabled={busy}>
                  Post protocol note
                </DSButton>
                <DSButton preset="secondary" onPress={onFetchTimeline} disabled={busy}>
                  Refresh operations timeline
                </DSButton>
              </DSCard>

              <DSCard style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Incidents and recommendation</Text>
                <DSButton preset="secondary" onPress={onPostIncident} disabled={busy}>
                  Post incident
                </DSButton>
                <DSButton preset="secondary" onPress={onFetchIncidents} disabled={busy}>
                  Refresh incidents
                </DSButton>
                <DSButton preset="secondary" onPress={onGenerateRecommendation} disabled={busy || noIncidents}>
                  Generate recommendation
                </DSButton>
              {noIncidents ? (
                <Text style={styles.body}>Generate recommendation is disabled until incidents are loaded.</Text>
              ) : null}
                <DSButton preset="secondary" onPress={onAcceptRecommendation} disabled={busy || !recommendationPending}>
                  Accept recommendation
                </DSButton>
                <DSButton preset="secondary" onPress={onRejectRecommendation} disabled={busy || !recommendationPending}>
                  Reject recommendation
                </DSButton>
              {!recommendationPending ? (
                <Text style={styles.body}>Recommendation decision controls unlock only when a recommendation is pending.</Text>
              ) : null}
              </DSCard>

              {room.course?.checkpoints && room.course.checkpoints.length > 0 ? (
                <DSCard style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>Checkpoint operations</Text>
                  <Text style={[styles.label, { marginTop: 8 }]}>Checkpoint stations</Text>
                  {!hasProjection ? (
                    <Text style={styles.body}>Fetch projection first, then station controls will unlock.</Text>
                  ) : null}
                  {!canEditCheckpointStops ? (
                    <Text style={styles.body}>
                      Station timing controls require crew role access (crew_member, crew_chief, or team_manager).
                    </Text>
                  ) : null}
                  {room.course.checkpoints.map((cp) => {
                    const arrival = stationArrivalAt[cp.id];
                    return (
                      <View key={cp.id} style={{ gap: 4 }}>
                        <Text style={styles.body}>
                          {cp.id}
                          {cp.plannedStopSeconds ? ` · ${cp.plannedStopSeconds}s planned` : ""}
                        </Text>
                        {arrival ? (
                          <>
                            <Text style={[styles.code, styles.successText]}>
                              At station since {arrival.slice(11, 19)}Z
                            </Text>
                            <DSButton
                              preset="primary"
                              disabled={!canUseCheckpointControls}
                              onPress={() => onEnqueueManualStop(cp.id, arrival)}
                            >
                              Exit station to enqueue stop
                            </DSButton>
                          </>
                        ) : (
                          <DSButton
                            preset="secondary"
                            disabled={!canUseCheckpointControls}
                            onPress={() => onRecordStationArrival(cp.id)}
                          >
                            Enter station
                          </DSButton>
                        )}
                      </View>
                    );
                  })}
                </DSCard>
              ) : null}
            </>
          ) : null}
          {roomInactive ? (
            <Text style={styles.body}>Checkpoint, recommendation, and task controls unlock after the room is active.</Text>
          ) : null}
        </>
      ) : null}
      <DSCard style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Account</Text>
        <DSButton preset="secondary" onPress={onSignOut}>
          Sign out
        </DSButton>
      </DSCard>
    </>
  );
}
