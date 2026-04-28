import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type { CheckpointVisitSource, OpsTimelineEvent, RaceRoomProjection, SyncStatus } from "@crewcue/contracts";

type Styles = Record<string, any>;

export function ProjectionEndpointReadout({
  styles,
  projection,
  projectionPolledAt,
  showEndpointLabel
}: {
  styles: Styles;
  projection: RaceRoomProjection;
  projectionPolledAt?: string;
  showEndpointLabel: boolean;
}): ReactElement {
  return (
    <View style={{ marginTop: showEndpointLabel ? 16 : 0 }}>
      {showEndpointLabel ? <Text style={styles.label}>GET /race-rooms/:id/projection</Text> : null}
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
          {showEndpointLabel ? (
            <>
              <Text style={styles.body}>Assumed headwind (m/s)</Text>
              <Text style={styles.code}>{String(projection.weatherStub.assumedHeadwindMps)}</Text>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function stoppageSummaryRows(styles: Styles, projection: RaceRoomProjection): ReactElement {
  if (!projection.stoppageSummary) {
    return (
      <Text style={[styles.body, { color: "#9ca3af" }]}>
        No aggregate stoppage on this projection yet (course may omit planned stops, or visits not computed).
      </Text>
    );
  }
  const s = projection.stoppageSummary;
  return (
    <>
      <View style={styles.stoppageRow}>
        <Text style={styles.body}>Planned total</Text>
        <Text style={styles.code}>{s.totalPlannedStopSeconds}s</Text>
      </View>
      <View style={styles.stoppageRow}>
        <Text style={styles.body}>Actual total</Text>
        <Text style={styles.code}>{s.totalActualStopSeconds}s</Text>
      </View>
      {s.totalDeltaStopSeconds !== null ? (
        <View style={styles.stoppageRow}>
          <Text style={styles.body}>Delta</Text>
          <Text style={[styles.code, { color: s.totalDeltaStopSeconds > 0 ? "#fca5a5" : "#86efac" }]}>
            {s.totalDeltaStopSeconds > 0 ? "+" : ""}
            {s.totalDeltaStopSeconds}s
          </Text>
        </View>
      ) : null}
      <View style={styles.stoppageRow}>
        <Text style={styles.body}>Remaining planned</Text>
        <Text style={styles.code}>{s.remainingPlannedStopSeconds}s</Text>
      </View>
    </>
  );
}

export function StoppageSummaryReadout({
  styles,
  projection,
  layout
}: {
  styles: Styles;
  projection: RaceRoomProjection;
  layout: "card" | "embedded";
}): ReactElement {
  const rows = stoppageSummaryRows(styles, projection);

  if (layout === "card") {
    return (
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>WS2 Stoppage summary</Text>
        {rows}
      </View>
    );
  }

  return (
    <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: "#1f2937", paddingTop: 12 }}>
      <Text style={[styles.summaryTitle, { marginBottom: 8 }]}>WS2 Stoppage summary</Text>
      {rows}
    </View>
  );
}

export function CheckpointSplitsReadout({
  styles,
  projection,
  canToggleResolvedSource,
  onToggleResolvedSource,
  layout
}: {
  styles: Styles;
  projection: RaceRoomProjection;
  canToggleResolvedSource: boolean;
  onToggleResolvedSource: (
    checkpointId: string,
    visitIndex: number,
    resolvedSource: CheckpointVisitSource
  ) => Promise<void>;
  layout: "card" | "embedded";
}): ReactElement {
  const splits =
    projection.checkpointSplits && projection.checkpointSplits.length > 0 ? (
      projection.checkpointSplits.map((split) => (
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
                  <Text style={[styles.toggleButtonLabel, !canToggleResolvedSource ? { color: "#9ca3af" } : null]}>
                    → use {visit.resolvedSource === "auto" ? "manual_crew" : "auto"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ))
    ) : layout === "embedded" ? (
      <Text style={[styles.body, { color: "#9ca3af" }]}>No checkpoint splits on this projection yet.</Text>
    ) : (
      <Text style={[styles.code, { color: "#6b7280" }]}>— no splits —</Text>
    );

  if (layout === "card") {
    return (
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Checkpoint splits</Text>
        {splits}
      </View>
    );
  }

  return (
    <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: "#1f2937", paddingTop: 12 }}>
      <Text style={[styles.summaryTitle, { marginBottom: 8 }]}>Checkpoint splits</Text>
      {splits}
    </View>
  );
}

export function SyncHealthReadout({
  styles,
  syncHealth,
  layout
}: {
  styles: Styles;
  syncHealth: SyncStatus;
  layout: "card" | "embedded";
}): ReactElement {
  const staleDevices = syncHealth.devices.filter((device) => device.isStale);
  const staleCount = staleDevices.length;

  const body = (
    <>
      <Text style={styles.body}>Tracked devices</Text>
      <Text style={styles.code}>{syncHealth.devices.length}</Text>
      <Text style={styles.body}>Total pending</Text>
      <Text style={styles.code}>{syncHealth.totalPendingAcrossDevices}</Text>
      <Text style={styles.body}>Stale devices</Text>
      <Text style={staleCount > 0 ? styles.errorText : styles.code}>{staleCount}</Text>
      {staleCount > 0 ? (
        <>
          <Text style={styles.errorText}>
            Stale threshold exceeded ({syncHealth.staleAfterSeconds}s). Ask stale device owners to reopen app and flush
            outbox.
          </Text>
          {staleDevices.slice(0, 3).map((device) => (
            <Text key={device.deviceId} style={styles.code}>
              {device.deviceId}: heartbeat {device.lastHeartbeatAt}
            </Text>
          ))}
        </>
      ) : (
        <Text style={[styles.code, { color: "#86efac" }]}>
          All devices are fresh within {syncHealth.staleAfterSeconds}s.
        </Text>
      )}
      <Text style={styles.body}>Evaluated at</Text>
      <Text style={styles.code}>{syncHealth.evaluatedAt}</Text>
    </>
  );

  if (layout === "card") {
    return (
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>WS5 sync health</Text>
        {body}
      </View>
    );
  }

  return body;
}

export function TimelineEventsReadout({
  styles,
  timeline,
  layout
}: {
  styles: Styles;
  timeline: OpsTimelineEvent[];
  layout: "card" | "embedded";
}): ReactElement {
  const inner = (
    <>
      <Text style={styles.body}>Events</Text>
      <Text style={styles.code}>{timeline.length} total</Text>
      {timeline.length === 0 ? (
        <Text style={[styles.code, { color: "#6b7280" }]}>
          No events yet. Trigger task/protocol actions and fetch timeline to verify operation history.
        </Text>
      ) : (
        [...timeline].reverse().slice(0, 6).map((event) => (
          <View key={event.id} style={styles.visitRow}>
            <Text style={styles.code}>
              {event.occurredAt.slice(11, 19)}Z · {event.kind}
            </Text>
            <Text style={styles.body}>{event.message}</Text>
            <Text style={[styles.code, { color: "#9ca3af" }]}>actor: {event.actorUserId}</Text>
          </View>
        ))
      )}
    </>
  );

  if (layout === "card") {
    return (
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Ops timeline</Text>
        {inner}
      </View>
    );
  }

  return inner;
}
