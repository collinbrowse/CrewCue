import type { ReactElement, ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type {
  AthletePingAcceptedResponse,
  AthletePingRejectedResponse,
  Role,
  CheckpointVisitSource,
  ExplainabilityRecord,
  IncidentEvent,
  OpsTimelineEvent,
  PlanDelta,
  ProtocolNote,
  RaceRoom,
  RaceRoomProjection,
  Recommendation,
  SyncStatus,
  CheckpointPlan,
  CrewAssignment,
  CrewTask
} from "@crewcue/contracts";
import {
  CheckpointSplitsReadout,
  ProjectionEndpointReadout,
  StoppageSummaryReadout,
  SyncHealthReadout,
  TimelineEventsReadout
} from "./operationalReadoutBlocks";

export type OperationalSummaryVariant = "full" | "phase1-part-a" | "phase1-part-b";

function Phase1SectionCard({ styles, title, children }: { styles: any; title: string; children: ReactNode }): ReactElement {
  return (
    <View style={[styles.summaryCard, { marginTop: 16 }]}>
      <Text style={styles.summaryTitle}>{title}</Text>
      {children}
    </View>
  );
}

type Props = {
  styles: any;
  variant?: OperationalSummaryVariant;
  room?: RaceRoom;
  roomDetail?: { room: RaceRoom; permissions: Record<string, boolean> };
  lastPing?: AthletePingAcceptedResponse | AthletePingRejectedResponse;
  syncHealth?: SyncStatus;
  projection?: RaceRoomProjection;
  projectionPolledAt?: string;
  lastProtocolNote?: ProtocolNote;
  timeline?: OpsTimelineEvent[];
  incidents?: IncidentEvent[];
  latestRecommendation?: Recommendation;
  latestExplainability?: ExplainabilityRecord | null;
  planDelta?: PlanDelta | null;
  taskBoard?: { checkpointPlans: CheckpointPlan[]; tasks: CrewTask[]; assignments: CrewAssignment[] };
  onToggleResolvedSource: (
    checkpointId: string,
    visitIndex: number,
    resolvedSource: CheckpointVisitSource
  ) => Promise<void>;
  canToggleResolvedSource: boolean;
  onEnqueueTaskAction: (
    action: "assign" | "start" | "complete",
    task: CrewTask
  ) => Promise<void>;
  canMutateTasks: boolean;
  taskAssigneeUserId?: string;
  taskAssigneeRole?: Role;
};

export function OperationalSummarySections({
  styles,
  variant = "full",
  room,
  roomDetail,
  lastPing,
  syncHealth,
  projection,
  projectionPolledAt,
  lastProtocolNote,
  timeline,
  incidents,
  latestRecommendation,
  latestExplainability,
  planDelta,
  taskBoard,
  onToggleResolvedSource,
  canToggleResolvedSource,
  onEnqueueTaskAction,
  canMutateTasks,
  taskAssigneeUserId,
  taskAssigneeRole
}: Props): ReactElement {
  if (variant === "phase1-part-a") {
    return (
      <>
        <Phase1SectionCard styles={styles} title="Room">
          {!room ? (
            <Text style={styles.body}>No room in this session yet. Create one under Checkpoints and room actions.</Text>
          ) : (
            <>
              <Text style={styles.label}>Room id</Text>
              <Text style={styles.code}>{room.id}</Text>
              <Text style={styles.label}>Status / entitlement</Text>
              <Text style={styles.code}>
                {room.status} / {room.entitlement.status}
              </Text>
            </>
          )}
          {roomDetail ? (
            <>
              <Text style={[styles.label, { marginTop: 12 }]}>GET /race-rooms/:id</Text>
              <Text style={styles.body}>Name</Text>
              <Text style={styles.code}>{roomDetail.room.name}</Text>
              <Text style={styles.body}>Permissions</Text>
              <Text style={styles.code}>{JSON.stringify(roomDetail.permissions, null, 2)}</Text>
            </>
          ) : null}
          {lastPing ? (
            <>
              <Text style={[styles.label, { marginTop: 12 }]}>Last ping</Text>
              {lastPing.decision === "accepted" ? (
                <>
                  <Text style={[styles.code, { color: "#86efac" }]}>accepted · {lastPing.pingId}</Text>
                  <Text style={styles.code}>{lastPing.recordedAt}</Text>
                </>
              ) : (
                <Text style={styles.errorText}>rejected — {lastPing.reason}</Text>
              )}
            </>
          ) : null}
        </Phase1SectionCard>

        <Phase1SectionCard styles={styles} title="Projection">
          {!projection ? (
            <Text style={styles.body}>
              No projection loaded. Activate the room, send a ping, then fetch projection from Checkpoints and room
              actions.
            </Text>
          ) : (
            <>
              <ProjectionEndpointReadout
                styles={styles}
                projection={projection}
                projectionPolledAt={projectionPolledAt}
                showEndpointLabel={false}
              />
              <StoppageSummaryReadout styles={styles} projection={projection} layout="embedded" />
              <CheckpointSplitsReadout
                styles={styles}
                projection={projection}
                canToggleResolvedSource={canToggleResolvedSource}
                onToggleResolvedSource={onToggleResolvedSource}
                layout="embedded"
              />
            </>
          )}
        </Phase1SectionCard>
      </>
    );
  }

  if (variant === "phase1-part-b") {
    return (
      <>
        <Phase1SectionCard styles={styles} title="Sync">
          {!syncHealth ? (
            <Text style={styles.body}>No sync health loaded yet. Use POST sync heartbeat / GET sync health from actions.</Text>
          ) : (
            <SyncHealthReadout styles={styles} syncHealth={syncHealth} layout="embedded" />
          )}
        </Phase1SectionCard>

        <Phase1SectionCard styles={styles} title="Timeline">
          {timeline === undefined ? (
            <Text style={styles.body}>Fetch ops timeline from actions to load recent events.</Text>
          ) : (
            <TimelineEventsReadout styles={styles} timeline={timeline} layout="embedded" />
          )}
        </Phase1SectionCard>
      </>
    );
  }

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

      {syncHealth ? <SyncHealthReadout styles={styles} syncHealth={syncHealth} layout="card" /> : null}

      {projection ? (
        <>
          <ProjectionEndpointReadout
            styles={styles}
            projection={projection}
            projectionPolledAt={projectionPolledAt}
            showEndpointLabel
          />
          <StoppageSummaryReadout styles={styles} projection={projection} layout="card" />
          <CheckpointSplitsReadout
            styles={styles}
            projection={projection}
            canToggleResolvedSource={canToggleResolvedSource}
            onToggleResolvedSource={onToggleResolvedSource}
            layout="card"
          />
        </>
      ) : null}

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Protocol notes</Text>
        {!lastProtocolNote ? (
          <Text style={[styles.code, { color: "#6b7280" }]}>
            No protocol note posted in this session yet. Post one to verify checkpoint guidance capture.
          </Text>
        ) : (
          <>
            <Text style={styles.body}>Latest note</Text>
            <Text style={styles.code}>{lastProtocolNote.id}</Text>
            <Text style={styles.body}>Category / checkpoint</Text>
            <Text style={styles.code}>
              {lastProtocolNote.category} @ {lastProtocolNote.checkpointId}
            </Text>
            <Text style={styles.body}>Body</Text>
            <Text style={styles.code}>{lastProtocolNote.body}</Text>
            <Text style={styles.body}>Recorded at</Text>
            <Text style={styles.code}>{lastProtocolNote.updatedAt}</Text>
          </>
        )}
      </View>

      {timeline !== undefined ? (
        <TimelineEventsReadout styles={styles} timeline={timeline} layout="card" />
      ) : null}

      {incidents !== undefined ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.label}>GET /race-rooms/:id/incidents</Text>
          <Text style={styles.body}>Incidents</Text>
          <Text style={styles.code}>{incidents.length} total</Text>
          {incidents.length === 0 ? (
            <Text style={[styles.code, { color: "#6b7280" }]}>— no incidents yet —</Text>
          ) : (
            [...incidents].slice(-3).reverse().map((incident) => (
              <Text key={incident.id} style={styles.code}>
                [{incident.severity}] {incident.category}: {incident.summary}
              </Text>
            ))
          )}
        </View>
      ) : null}

      {latestRecommendation ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>WS4 recommendation</Text>
          <Text style={styles.body}>Status</Text>
          <Text
            style={[
              styles.code,
              latestRecommendation.status === "accepted"
                ? { color: "#86efac" }
                : latestRecommendation.status === "rejected"
                  ? styles.errorText
                  : { color: "#fde68a" }
            ]}
          >
            {latestRecommendation.status}
          </Text>
          <Text style={styles.body}>Rationale</Text>
          <Text style={styles.code}>{latestRecommendation.rationale}</Text>
          <Text style={styles.body}>Proposed summary</Text>
          <Text style={styles.code}>{latestRecommendation.proposedSummary}</Text>
          {latestExplainability?.factors?.length ? (
            <>
              <Text style={styles.body}>Explainability factors</Text>
              <Text style={styles.code}>{latestExplainability.factors.join(" · ")}</Text>
            </>
          ) : null}
          {planDelta ? (
            <>
              <Text style={styles.body}>Latest plan delta</Text>
              <Text style={styles.code}>
                v{planDelta.fromVersion} → v{planDelta.toVersion}
              </Text>
              {planDelta.changes.slice(0, 3).map((change) => (
                <Text key={change} style={styles.code}>
                  - {change}
                </Text>
              ))}
            </>
          ) : null}
        </View>
      ) : null}

      {taskBoard ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.label}>GET /race-rooms/:id/tasks</Text>
          <Text style={styles.body}>Tasks</Text>
          <Text style={styles.code}>{taskBoard.tasks.length} total</Text>
          {!canMutateTasks ? (
            <Text style={styles.body}>Task execution controls require crew role access.</Text>
          ) : null}
          {taskBoard.tasks.length === 0 ? (
            <Text style={[styles.code, { color: "#6b7280" }]}>— no tasks on board —</Text>
          ) : (
            taskBoard.tasks.slice(0, 5).map((task) => (
              <View key={task.id} style={styles.visitRow}>
                <Text style={styles.code}>
                  [{task.status}] {task.title}
                </Text>
                <Text style={[styles.body, { marginTop: 2 }]}>{task.checkpointId}</Text>
                {task.status === "pending" ? (
                  <>
                    <Pressable
                      style={styles.secondaryButton}
                      disabled={!canMutateTasks || !taskAssigneeUserId || !taskAssigneeRole}
                      onPress={() => {
                        void onEnqueueTaskAction("assign", task);
                      }}
                    >
                      <Text style={styles.secondaryButtonLabel}>Assign to me</Text>
                    </Pressable>
                    <Pressable
                      style={styles.primaryButton}
                      disabled={!canMutateTasks}
                      onPress={() => {
                        void onEnqueueTaskAction("start", task);
                      }}
                    >
                      <Text style={styles.primaryButtonLabel}>Start task</Text>
                    </Pressable>
                  </>
                ) : null}
                {task.status === "in_progress" ? (
                  <Pressable
                    style={styles.primaryButton}
                    disabled={!canMutateTasks}
                    onPress={() => {
                      void onEnqueueTaskAction("complete", task);
                    }}
                  >
                    <Text style={styles.primaryButtonLabel}>Complete task</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </View>
      ) : null}
    </>
  );
}
