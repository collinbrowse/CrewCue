import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import type { AppStateStatus } from "react-native";
import type {
  AthletePingAcceptedResponse,
  AthletePingRejectedResponse,
  CheckpointPlan,
  CheckpointVisitSource,
  CrewAssignment,
  CrewTask,
  ExplainabilityRecord,
  IncidentEvent,
  OpsTimelineEvent,
  PlanDelta,
  ProtocolNote,
  RaceRoom,
  RaceRoomProjection,
  Recommendation,
  Role,
  SyncStatus
} from "@crewcue/contracts";
import type { AuthState } from "../auth/useAuth";
import type { OutboxOperation } from "../sync/outboxStore";

export type AuthedShellContextValue = {
  styles: any;
  baseUrl: string;
  auth: AuthState;
  appState: AppStateStatus;
  pendingOutboxCount: number;
  outbox: OutboxOperation[];
  outboxAutoProcessIntervalMs: number;
  apiError?: string;
  syncStatusMessage?: string;
  projection?: RaceRoomProjection;
  room?: RaceRoom;
  roomDetail?: { room: RaceRoom; permissions: Record<string, boolean> };
  lastPing?: AthletePingAcceptedResponse | AthletePingRejectedResponse;
  syncHealth?: SyncStatus;
  projectionPolledAt?: string;
  lastProtocolNote?: ProtocolNote;
  timeline?: OpsTimelineEvent[];
  incidents?: IncidentEvent[];
  latestRecommendation?: Recommendation;
  latestExplainability?: ExplainabilityRecord | null;
  planDelta?: PlanDelta | null;
  taskBoard?: { checkpointPlans: CheckpointPlan[]; tasks: CrewTask[]; assignments: CrewAssignment[] };
  busy: boolean;
  outboxProcessing: boolean;
  projectionPollEnabled: boolean;
  canEditCheckpointStops: boolean;
  canUseCheckpointControls: boolean;
  canEditTasks: boolean;
  currentRoomRole?: Role;
  stationArrivalAt: Record<string, string>;
  describeOutboxOperation: (op: OutboxOperation) => string;
  describeOutboxStatus: (status: OutboxOperation["status"]) => string;
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
  onToggleResolvedSource: (
    checkpointId: string,
    visitIndex: number,
    resolvedSource: CheckpointVisitSource
  ) => Promise<void>;
  onEnqueueTaskAction: (action: "assign" | "start" | "complete", task: CrewTask) => Promise<void>;
  onRetryOutboxOperationSafely: (operationId: string) => Promise<void>;
};

const AuthedShellContext = createContext<AuthedShellContextValue | null>(null);

export function AuthedShellProvider({
  value,
  children
}: {
  value: AuthedShellContextValue;
  children: ReactNode;
}): ReactElement {
  return <AuthedShellContext.Provider value={value}>{children}</AuthedShellContext.Provider>;
}

export function useAuthedShell(): AuthedShellContextValue {
  const ctx = useContext(AuthedShellContext);
  if (!ctx) {
    throw new Error("useAuthedShell must be used within AuthedShellProvider");
  }
  return ctx;
}
