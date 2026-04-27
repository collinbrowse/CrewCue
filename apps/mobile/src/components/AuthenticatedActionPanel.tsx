import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type { IncidentEvent, RaceRoom, Recommendation } from "@crewcue/contracts";

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
  onFetchRoomDetails: () => void;
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
  return (
    <>
      <Pressable style={styles.primaryButton} onPress={onCreateRoom} disabled={busy}>
        <Text style={styles.primaryButtonLabel}>{busy ? "Calling API..." : "Create race room (staging)"}</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={onProcessOutbox} disabled={busy || outboxProcessing}>
        <Text style={styles.secondaryButtonLabel}>{outboxProcessing ? "Processing..." : "Process all pending outbox items"}</Text>
      </Pressable>
      {room ? (
        <>
          <Pressable
            style={styles.secondaryButton}
            onPress={onMarkEntitlementPaid}
            disabled={busy || room.entitlement.status === "paid"}
          >
            <Text style={styles.secondaryButtonLabel}>
              {room.entitlement.status === "paid" ? "Entitlement already paid" : "Mark entitlement paid (staging)"}
            </Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onFetchRoomDetails} disabled={busy}>
            <Text style={styles.secondaryButtonLabel}>Fetch room (GET)</Text>
          </Pressable>
          {room.entitlement.status === "paid" && room.status === "draft" ? (
            <Pressable style={styles.primaryButton} onPress={onActivateRoom} disabled={busy}>
              <Text style={styles.primaryButtonLabel}>{busy ? "Calling API..." : "Activate room (staging)"}</Text>
            </Pressable>
          ) : null}
          {room.status === "active" ? (
            <>
              <Pressable style={styles.primaryButton} onPress={onSendPing} disabled={busy}>
                <Text style={styles.primaryButtonLabel}>{busy ? "Sending..." : "Send ping (staging)"}</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={onPostSyncHeartbeat} disabled={busy}>
                <Text style={styles.primaryButtonLabel}>{busy ? "Sending..." : "POST sync heartbeat"}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={onFetchSyncHealth} disabled={busy}>
                <Text style={styles.secondaryButtonLabel}>GET sync health</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={onFetchProjection} disabled={busy}>
                <Text style={styles.secondaryButtonLabel}>Fetch projection (GET)</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryButton, projectionPollEnabled ? styles.secondaryButtonActive : null]}
                onPress={onToggleProjectionPoll}
                disabled={busy}
              >
                <Text style={styles.secondaryButtonLabel}>
                  {projectionPollEnabled ? "Auto-refresh projection: ON (8s)" : "Auto-refresh projection: OFF"}
                </Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={onFetchTaskBoard} disabled={busy}>
                <Text style={styles.secondaryButtonLabel}>Fetch task board (GET)</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={onPostProtocolNote} disabled={busy}>
                <Text style={styles.secondaryButtonLabel}>Post protocol note (staging)</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={onFetchTimeline} disabled={busy}>
                <Text style={styles.secondaryButtonLabel}>Fetch ops timeline (GET)</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={onPostIncident} disabled={busy}>
                <Text style={styles.secondaryButtonLabel}>Post incident (WS4)</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={onFetchIncidents} disabled={busy}>
                <Text style={styles.secondaryButtonLabel}>Fetch incidents (GET)</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={onGenerateRecommendation}
                disabled={busy || !incidents || incidents.length === 0}
              >
                <Text style={styles.secondaryButtonLabel}>Generate recommendation</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={onAcceptRecommendation}
                disabled={busy || latestRecommendation?.status !== "pending"}
              >
                <Text style={styles.secondaryButtonLabel}>Accept recommendation</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={onRejectRecommendation}
                disabled={busy || latestRecommendation?.status !== "pending"}
              >
                <Text style={styles.secondaryButtonLabel}>Reject recommendation</Text>
              </Pressable>
              {room.course?.checkpoints && room.course.checkpoints.length > 0 ? (
                <>
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
                            <Text style={[styles.code, { color: "#86efac" }]}>At station since {arrival.slice(11, 19)}Z</Text>
                            <Pressable
                              style={styles.primaryButton}
                              disabled={!canUseCheckpointControls}
                              onPress={() => onEnqueueManualStop(cp.id, arrival)}
                            >
                              <Text style={styles.primaryButtonLabel}>Exit station → enqueue stop</Text>
                            </Pressable>
                          </>
                        ) : (
                          <Pressable
                            style={styles.secondaryButton}
                            disabled={!canUseCheckpointControls}
                            onPress={() => onRecordStationArrival(cp.id)}
                          >
                            <Text style={styles.secondaryButtonLabel}>Enter station</Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      <Pressable style={styles.secondaryButton} onPress={onSignOut}>
        <Text style={styles.secondaryButtonLabel}>Sign out</Text>
      </Pressable>
    </>
  );
}
