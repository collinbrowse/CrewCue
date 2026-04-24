import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type {
  AthletePingAcceptedResponse,
  AthletePingRejectedResponse,
  CheckpointVisitSource,
  OpsTimelineEvent,
  ProtocolNote,
  RaceRoom,
  RaceRoomProjection,
  SyncStatus,
  CheckpointPlan,
  CrewAssignment,
  CrewTask
} from "@crewcue/contracts";

type Props = {
  styles: any;
  room?: RaceRoom;
  roomDetail?: { room: RaceRoom; permissions: Record<string, boolean> };
  lastPing?: AthletePingAcceptedResponse | AthletePingRejectedResponse;
  syncHealth?: SyncStatus;
  projection?: RaceRoomProjection;
  projectionPolledAt?: string;
  lastProtocolNote?: ProtocolNote;
  timeline?: OpsTimelineEvent[];
  taskBoard?: { checkpointPlans: CheckpointPlan[]; tasks: CrewTask[]; assignments: CrewAssignment[] };
  onToggleResolvedSource: (
    checkpointId: string,
    visitIndex: number,
    resolvedSource: CheckpointVisitSource
  ) => Promise<void>;
  canToggleResolvedSource: boolean;
};

export function OperationalSummarySections({
  styles,
  room,
  roomDetail,
  lastPing,
  syncHealth,
  projection,
  projectionPolledAt,
  lastProtocolNote,
  timeline,
  taskBoard,
  onToggleResolvedSource,
  canToggleResolvedSource
}: Props): ReactElement {
  return (
    <>
      {room ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.label}>Created room</Text>
          <Text style={styles.code}>{room.id}</Text>
          <Text style={styles.label}>Status / entitlement</Text>
          <Text style={styles.code}>
            {room.status} / {room.entitlement.status}
          </Text>
        </View>
      ) : null}

      {roomDetail ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.label}>GET /race-rooms/:id</Text>
          <Text style={styles.body}>Name</Text>
          <Text style={styles.code}>{roomDetail.room.name}</Text>
          <Text style={styles.body}>Status / entitlement</Text>
          <Text style={styles.code}>
            {roomDetail.room.status} / {roomDetail.room.entitlement.status}
          </Text>
          <Text style={styles.body}>Permissions</Text>
          <Text style={styles.code}>{JSON.stringify(roomDetail.permissions, null, 2)}</Text>
        </View>
      ) : null}

      {lastPing ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.label}>Last ping</Text>
          {lastPing.decision === "accepted" ? (
            <>
              <Text style={styles.body}>Decision</Text>
              <Text style={[styles.code, { color: "#86efac" }]}>accepted</Text>
              <Text style={styles.body}>Ping ID</Text>
              <Text style={styles.code}>{lastPing.pingId}</Text>
              <Text style={styles.body}>Recorded at</Text>
              <Text style={styles.code}>{lastPing.recordedAt}</Text>
            </>
          ) : (
            <>
              <Text style={styles.body}>Decision</Text>
              <Text style={styles.errorText}>rejected — {lastPing.reason}</Text>
              <Text style={styles.body}>Message</Text>
              <Text style={styles.errorText}>{lastPing.message}</Text>
            </>
          )}
        </View>
      ) : null}

      {syncHealth ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>WS5 sync health</Text>
          <Text style={styles.body}>Tracked devices</Text>
          <Text style={styles.code}>{syncHealth.devices.length}</Text>
          <Text style={styles.body}>Total pending</Text>
          <Text style={styles.code}>{syncHealth.totalPendingAcrossDevices}</Text>
          <Text style={styles.body}>Stale devices</Text>
          <Text style={styles.code}>{syncHealth.devices.filter((device) => device.isStale).length}</Text>
          <Text style={styles.body}>Evaluated at</Text>
          <Text style={styles.code}>{syncHealth.evaluatedAt}</Text>
        </View>
      ) : null}

      {projection ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.label}>GET /race-rooms/:id/projection</Text>
          <Text style={styles.body}>Confidence</Text>
          <Text style={[styles.code, { color: projection.projectionConfidence === "fresh" ? "#86efac" : "#fde68a" }]}>
            {projection.projectionConfidence}
          </Text>
          <Text style={styles.body}>Progress</Text>
          <Text style={styles.code}>{Math.round(projection.progressMeters)} m</Text>
          <Text style={styles.body}>ETA finish</Text>
          <Text style={styles.code}>{projection.etaFinishPlanIso}</Text>
          <Text style={styles.body}>Staleness (s since last ping)</Text>
          <Text style={styles.code}>{Math.round(projection.secondsSinceLastAcceptedPing)} s</Text>
          {projectionPolledAt ? (
            <>
              <Text style={styles.body}>Last projection fetch</Text>
              <Text style={styles.code}>{projectionPolledAt}</Text>
            </>
          ) : null}
          {projection.weatherStub ? (
            <>
              <Text style={styles.body}>Weather stub</Text>
              <Text style={styles.code}>{projection.weatherStub.summary}</Text>
              <Text style={styles.body}>Assumed headwind (m/s)</Text>
              <Text style={styles.code}>{String(projection.weatherStub.assumedHeadwindMps)}</Text>
            </>
          ) : null}
        </View>
      ) : null}

      {projection?.stoppageSummary ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>WS2 Stoppage summary</Text>
          <View style={styles.stoppageRow}>
            <Text style={styles.body}>Planned total</Text>
            <Text style={styles.code}>{projection.stoppageSummary.totalPlannedStopSeconds}s</Text>
          </View>
          <View style={styles.stoppageRow}>
            <Text style={styles.body}>Actual total</Text>
            <Text style={styles.code}>{projection.stoppageSummary.totalActualStopSeconds}s</Text>
          </View>
          {projection.stoppageSummary.totalDeltaStopSeconds !== null ? (
            <View style={styles.stoppageRow}>
              <Text style={styles.body}>Delta</Text>
              <Text
                style={[
                  styles.code,
                  { color: projection.stoppageSummary.totalDeltaStopSeconds > 0 ? "#fca5a5" : "#86efac" }
                ]}
              >
                {projection.stoppageSummary.totalDeltaStopSeconds > 0 ? "+" : ""}
                {projection.stoppageSummary.totalDeltaStopSeconds}s
              </Text>
            </View>
          ) : null}
          <View style={styles.stoppageRow}>
            <Text style={styles.body}>Remaining planned</Text>
            <Text style={styles.code}>{projection.stoppageSummary.remainingPlannedStopSeconds}s</Text>
          </View>
        </View>
      ) : null}

      {projection?.checkpointSplits && projection.checkpointSplits.length > 0 ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Checkpoint splits</Text>
          {projection.checkpointSplits.map((split) => (
            <View key={split.checkpointId} style={{ marginTop: 12 }}>
              <View style={styles.stoppageRow}>
                <Text style={[styles.code, { fontWeight: "600" }]}>{split.checkpointId}</Text>
                {split.crossedAtRecordedAt ? (
                  <Text style={[styles.code, { color: "#86efac" }]}>{split.crossedAtRecordedAt.slice(11, 19)}Z</Text>
                ) : (
                  <Text style={[styles.code, { color: "#6b7280" }]}>not crossed</Text>
                )}
              </View>
              {split.plannedStopSeconds > 0 ? (
                <View style={styles.stoppageRow}>
                  <Text style={styles.body}>Planned / actual stop</Text>
                  <Text style={styles.code}>
                    {split.plannedStopSeconds}s / {split.totalActualStopSeconds !== null ? `${split.totalActualStopSeconds}s` : "—"}
                  </Text>
                </View>
              ) : null}
              {split.visits.map((visit) => (
                <View key={visit.visitIndex} style={styles.visitRow}>
                  <Text style={styles.body}>
                    Visit #{visit.visitIndex} · source: <Text style={styles.code}>{visit.resolvedSource}</Text>
                    {visit.activeActualStopSeconds !== null ? ` · ${visit.activeActualStopSeconds}s` : ""}
                  </Text>
                  {visit.note ? <Text style={[styles.body, { color: "#9ca3af" }]}>{visit.note}</Text> : null}
                  {visit.autoDetected && visit.manualEntry ? (
                    <Pressable
                      style={styles.toggleButton}
                      disabled={!canToggleResolvedSource}
                      onPress={() => {
                        void onToggleResolvedSource(
                          split.checkpointId,
                          visit.visitIndex,
                          visit.resolvedSource === "auto" ? "manual_crew" : "auto"
                        );
                      }}
                    >
                      <Text
                        style={[
                          styles.toggleButtonLabel,
                          !canToggleResolvedSource ? { color: "#9ca3af" } : null
                        ]}
                      >
                        → use {visit.resolvedSource === "auto" ? "manual_crew" : "auto"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {lastProtocolNote ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.label}>POST /race-rooms/:id/protocol-notes</Text>
          <Text style={styles.body}>Note ID</Text>
          <Text style={styles.code}>{lastProtocolNote.id}</Text>
          <Text style={styles.body}>Category / checkpoint</Text>
          <Text style={styles.code}>
            {lastProtocolNote.category} @ {lastProtocolNote.checkpointId}
          </Text>
          <Text style={styles.body}>Body</Text>
          <Text style={styles.code}>{lastProtocolNote.body}</Text>
        </View>
      ) : null}

      {timeline !== undefined ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.label}>GET /race-rooms/:id/timeline</Text>
          <Text style={styles.body}>Events</Text>
          <Text style={styles.code}>{timeline.length} total</Text>
          {timeline.length === 0 ? (
            <Text style={[styles.code, { color: "#6b7280" }]}>— no events yet —</Text>
          ) : (
            [...timeline].reverse().slice(0, 4).map((e) => (
              <Text key={e.id} style={styles.code}>
                {e.kind}: {e.message}
              </Text>
            ))
          )}
        </View>
      ) : null}

      {taskBoard ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.label}>GET /race-rooms/:id/tasks</Text>
          <Text style={styles.body}>Tasks</Text>
          <Text style={styles.code}>{taskBoard.tasks.length} total</Text>
          {taskBoard.tasks.length === 0 ? (
            <Text style={[styles.code, { color: "#6b7280" }]}>— no tasks on board —</Text>
          ) : (
            taskBoard.tasks.slice(0, 3).map((t) => (
              <Text key={t.id} style={styles.code}>
                [{t.status}] {t.title}
              </Text>
            ))
          )}
        </View>
      ) : null}
    </>
  );
}
