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
  MergeRecord,
  OpsTimelineEvent,
  PlanDelta,
  ProtocolNote,
  RaceRoom,
  RaceRoomProjection,
  Recommendation,
  RaceRoomInvite,
  Role,
  SyncQueueDiagnostics,
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
  raceProfile?: {
    creatorName: string;
    raceName: string;
    raceDescription: string;
    crewName: string;
    setupComplete: boolean;
  };
  onboardingIntent?: "none" | "signupAthlete" | "joinCrew";
  onboardingJoinDraft?: { roomCode: string; displayName: string };
  onboardingNotificationsSeen: boolean;
  onboardingNotificationsRequired: boolean;
  roomDetail?: { room: RaceRoom; permissions: Record<string, boolean> };
  myRaceRooms?: RaceRoom[];
  invites?: RaceRoomInvite[];
  lastPing?: AthletePingAcceptedResponse | AthletePingRejectedResponse;
  syncHealth?: SyncStatus;
  queueDiagnostics?: SyncQueueDiagnostics[];
  mergeRecords?: MergeRecord[];
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
  canLogMergeTelemetry: boolean;
  stationArrivalAt: Record<string, string>;
  describeOutboxOperation: (op: OutboxOperation) => string;
  describeOutboxStatus: (status: OutboxOperation["status"]) => string;
  onCreateRoom: (input?: {
    raceName?: string;
    creatorName?: string;
    raceDescription?: string;
    crewName?: string;
  }) => Promise<RaceRoom | undefined>;
  onSaveRaceProfile: (profile: {
    creatorName: string;
    raceName: string;
    raceDescription: string;
    crewName: string;
    setupComplete: boolean;
  }) => Promise<void>;
  onProcessOutbox: () => void;
  onMarkEntitlementPaid: () => void;
  onFetchRoomDetails: (roomId?: string) => Promise<void>;
  onApplyRaceRoomFromServer: (room: RaceRoom) => void;
  onIssueInvite: (input: { email: string; role: RaceRoomInvite["role"] }) => Promise<void>;
  onFetchInvites: () => Promise<void>;
  onJoinRoomByCode: (roomCode: string) => Promise<boolean>;
  onUpdateMemberRole: (memberUserId: string, role: RaceRoomInvite["role"]) => Promise<void>;
  onUpdateMyRosterDisplayName: (displayName: string) => Promise<void>;
  onRemoveMember: (memberUserId: string) => Promise<void>;
  onFetchMyRaceRooms: () => Promise<void>;
  onSelectRaceRoom: (room: RaceRoom) => Promise<void>;
  onActivateRoom: () => void;
  onSendPing: () => void;
  onPostSyncHeartbeat: () => void;
  onFetchSyncHealth: () => void;
  onRefreshWs5Telemetry: () => Promise<void>;
  onPushQueueDiagnosticsSnapshot: () => Promise<void>;
  onRecordOutboxMergeTelemetry: (operationId: string) => Promise<void>;
  onFetchProjection: () => void;
  onToggleProjectionPoll: () => void;
  onSetProjectionPollEnabled: (enabled: boolean) => void;
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
  onSignOut: () => Promise<void>;
  onToggleResolvedSource: (
    checkpointId: string,
    visitIndex: number,
    resolvedSource: CheckpointVisitSource
  ) => Promise<void>;
  onEnqueueTaskAction: (action: "assign" | "start" | "complete", task: CrewTask) => Promise<void>;
  onRetryOutboxOperationSafely: (operationId: string) => Promise<void>;
  onRefreshOnboardingStage: () => Promise<void>;
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
