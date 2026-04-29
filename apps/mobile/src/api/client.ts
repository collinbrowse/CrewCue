import type {
  AthletePingAcceptedResponse,
  AthletePingRejectedResponse,
  CheckpointPlan,
  CrewAssignment,
  CrewTask,
  ExplainabilityRecord,
  IncidentCategory,
  IncidentEvent,
  IncidentSeverity,
  MergeRecord,
  MergeStrategyKind,
  OpsTimelineEvent,
  PlanDelta,
  ProtocolNote,
  ProtocolNoteCategory,
  RaceRoom,
  RaceRoomInvite,
  RaceCourse,
  RaceRoomEntitlement,
  RaceRoomProjection,
  Recommendation,
  SyncQueueDiagnostics,
  SyncStatus
} from "@crewcue/contracts";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type ApiClientOptions = {
  baseUrl: string;
  accessToken: string;
};

async function request<T>(
  options: ApiClientOptions,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    Accept: "application/json"
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${options.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `API error ${res.status}`;
    throw new ApiError(res.status, parsed, message);
  }
  return parsed as T;
}

export type CreateRaceRoomInput = {
  teamId: string;
  athleteId: string;
  name: string;
  creatorRole?: "athlete" | "crew_member" | "crew_chief" | "team_manager";
};

export type ActivateRaceRoomInput = {
  eventEndsAt: string;
};

export type UpdateRaceCourseInput = {
  course: RaceCourse;
  plannedPaceSecondsPerKm: number;
};

export type PostPingInput = {
  latitude: number;
  longitude: number;
  recordedAt: string;
  horizontalAccuracyMeters?: number;
  uploadIntervalSeconds?: number;
};

export type PingResponse = AthletePingAcceptedResponse | AthletePingRejectedResponse;

export type PostSyncHeartbeatInput = {
  deviceId: string;
  pendingQueueCount: number;
  lastSuccessfulFlushAt?: string;
};

export type PostSyncHeartbeatResponse = {
  ok: true;
  lastHeartbeatAt: string;
};

export type GetSyncHealthOptions = {
  staleAfterSeconds?: number;
};

export type GetSyncHealthResponse = {
  syncStatus: SyncStatus;
};

export type GetQueueDiagnosticsResponse = {
  diagnostics: SyncQueueDiagnostics[];
};

export type PostQueueDiagnosticsInput = {
  deviceId: string;
  pendingByOpType: Record<string, number>;
};

export type PostQueueDiagnosticsResponse = {
  diagnostics: SyncQueueDiagnostics;
};

export type GetMergeRecordsResponse = {
  mergeRecords: MergeRecord[];
};

export type PostMergeRecordInput = {
  deviceId: string;
  conflictKey: string;
  strategy: MergeStrategyKind;
  notes?: string;
};

export type PostMergeRecordResponse = {
  mergeRecord: MergeRecord;
};

export type AssignTaskInput = {
  assigneeUserId: string;
  assigneeRole: CrewAssignment["assigneeRole"];
};

export type ManualCheckpointStopInput = {
  arrivalAt: string;
  departureAt: string;
  note?: string;
};

export type UpdateCheckpointVisitSourceInput = {
  resolvedSource: "auto" | "manual_crew";
};

export type PostIncidentInput = {
  category: IncidentCategory;
  severity: IncidentSeverity;
  checkpointId?: string;
  summary: string;
  details?: string;
  recordedAt?: string;
};

export type IssueInviteInput = {
  email: string;
  role: RaceRoomInvite["role"];
  expiresAt?: string;
};

export function createApiClient(options: ApiClientOptions) {
  return {
    health: () => request<{ status: string }>(options, "GET", "/health/live"),
    createRaceRoom: (input: CreateRaceRoomInput) =>
      request<RaceRoom>(options, "POST", "/race-rooms", input),
    updateEntitlement: (roomId: string, status: "unpaid" | "paid" | "expired") =>
      request<RaceRoomEntitlement>(options, "POST", `/race-rooms/${roomId}/entitlement`, { status }),
    getRaceRoom: (roomId: string) =>
      request<{ room: RaceRoom; permissions: Record<string, boolean> }>(
        options,
        "GET",
        `/race-rooms/${roomId}`
      ),
    issueInvite: (roomId: string, input: IssueInviteInput) =>
      request<Pick<RaceRoomInvite, "token" | "roomId" | "email" | "role" | "expiresAt">>(
        options,
        "POST",
        `/race-rooms/${roomId}/invites`,
        input
      ),
    getInvites: (roomId: string) =>
      request<{ invites: RaceRoomInvite[] }>(options, "GET", `/race-rooms/${roomId}/invites`),
    activateRaceRoom: (roomId: string, input: ActivateRaceRoomInput) =>
      request<RaceRoom>(options, "POST", `/race-rooms/${roomId}/activate`, input),
    updateRaceCourse: (roomId: string, input: UpdateRaceCourseInput) =>
      request<RaceRoom>(options, "PUT", `/race-rooms/${roomId}/course`, input),
    postPing: (roomId: string, input: PostPingInput) =>
      request<PingResponse>(options, "POST", `/race-rooms/${roomId}/pings`, input),
    getProjection: (roomId: string) =>
      request<RaceRoomProjection>(options, "GET", `/race-rooms/${roomId}/projection`),
    getTaskBoard: (roomId: string) =>
      request<{ checkpointPlans: CheckpointPlan[]; tasks: CrewTask[]; assignments: CrewAssignment[] }>(
        options,
        "GET",
        `/race-rooms/${roomId}/tasks`
      ),
    assignTask: (roomId: string, taskId: string, input: AssignTaskInput) =>
      request<{ task: CrewTask; assignment: CrewAssignment }>(
        options,
        "POST",
        `/race-rooms/${roomId}/tasks/${taskId}/assign`,
        input
      ),
    startTask: (roomId: string, taskId: string) =>
      request<{ task: CrewTask }>(options, "POST", `/race-rooms/${roomId}/tasks/${taskId}/start`),
    completeTask: (roomId: string, taskId: string) =>
      request<{ task: CrewTask }>(options, "POST", `/race-rooms/${roomId}/tasks/${taskId}/complete`),
    postSyncHeartbeat: (roomId: string, input: PostSyncHeartbeatInput) =>
      request<PostSyncHeartbeatResponse>(options, "POST", `/race-rooms/${roomId}/sync/heartbeat`, input),
    getSyncHealth: (roomId: string, query?: GetSyncHealthOptions) =>
      request<GetSyncHealthResponse>(
        options,
        "GET",
        `/race-rooms/${roomId}/sync/health${
          typeof query?.staleAfterSeconds === "number"
            ? `?staleAfterSeconds=${encodeURIComponent(String(query.staleAfterSeconds))}`
            : ""
        }`
      ),
    getQueueDiagnostics: (roomId: string, query?: { limit?: number }) =>
      request<GetQueueDiagnosticsResponse>(
        options,
        "GET",
        `/race-rooms/${roomId}/sync/queue-diagnostics${
          typeof query?.limit === "number" ? `?limit=${encodeURIComponent(String(query.limit))}` : ""
        }`
      ),
    postQueueDiagnostics: (roomId: string, input: PostQueueDiagnosticsInput) =>
      request<PostQueueDiagnosticsResponse>(options, "POST", `/race-rooms/${roomId}/sync/queue-diagnostics`, input),
    getMergeRecords: (roomId: string, query?: { limit?: number }) =>
      request<GetMergeRecordsResponse>(
        options,
        "GET",
        `/race-rooms/${roomId}/sync/merge-records${
          typeof query?.limit === "number" ? `?limit=${encodeURIComponent(String(query.limit))}` : ""
        }`
      ),
    postMergeRecord: (roomId: string, input: PostMergeRecordInput) =>
      request<PostMergeRecordResponse>(options, "POST", `/race-rooms/${roomId}/sync/merge-records`, input),
    postProtocolNote: (
      roomId: string,
      input: { checkpointId: string; category: ProtocolNoteCategory; body: string }
    ) => request<{ protocolNote: ProtocolNote }>(options, "POST", `/race-rooms/${roomId}/protocol-notes`, input),
    getTimeline: (roomId: string) =>
      request<{ events: OpsTimelineEvent[] }>(options, "GET", `/race-rooms/${roomId}/timeline`),
    postIncident: (roomId: string, input: PostIncidentInput) =>
      request<{ incident: IncidentEvent }>(options, "POST", `/race-rooms/${roomId}/incidents`, input),
    getIncidents: (roomId: string) => request<{ incidents: IncidentEvent[] }>(options, "GET", `/race-rooms/${roomId}/incidents`),
    generateRecommendation: (roomId: string, incidentId: string) =>
      request<{ recommendation: Recommendation; explainability: ExplainabilityRecord }>(
        options,
        "POST",
        `/race-rooms/${roomId}/incidents/${incidentId}/recommendations`
      ),
    getRecommendation: (roomId: string, recommendationId: string) =>
      request<{ recommendation: Recommendation; explainability: ExplainabilityRecord | null }>(
        options,
        "GET",
        `/race-rooms/${roomId}/recommendations/${recommendationId}`
      ),
    acceptRecommendation: (roomId: string, recommendationId: string) =>
      request<{ recommendation: Recommendation }>(
        options,
        "POST",
        `/race-rooms/${roomId}/recommendations/${recommendationId}/accept`
      ),
    rejectRecommendation: (roomId: string, recommendationId: string) =>
      request<{ recommendation: Recommendation }>(
        options,
        "POST",
        `/race-rooms/${roomId}/recommendations/${recommendationId}/reject`
      ),
    getPlanDelta: (roomId: string) => request<{ planDelta: PlanDelta | null }>(options, "GET", `/race-rooms/${roomId}/plan-delta`),
    postManualCheckpointStop: (roomId: string, checkpointId: string, input: ManualCheckpointStopInput) =>
      request<{ checkpointSplit: RaceRoomProjection["checkpointSplits"][number] }>(
        options,
        "POST",
        `/race-rooms/${roomId}/checkpoints/${checkpointId}/manual-stop`,
        input
      ),
    patchCheckpointVisitResolvedSource: (
      roomId: string,
      checkpointId: string,
      visitIndex: number,
      input: UpdateCheckpointVisitSourceInput
    ) =>
      request<{ checkpointSplit: RaceRoomProjection["checkpointSplits"][number] }>(
        options,
        "PATCH",
        `/race-rooms/${roomId}/checkpoints/${checkpointId}/visits/${visitIndex}/resolved-source`,
        input
      )
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
