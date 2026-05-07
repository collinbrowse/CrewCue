import type {
  AthletePingAcceptedResponse,
  AthletePingRejectedResponse,
  ChatDeviceKey,
  ChatKeyEnvelope,
  ChatNotificationPref,
  ChatNotificationPrefRecord,
  ChatPushPlatform,
  ChatPushTokenRecord,
  ChatRetentionResult,
  ChatStreamTokenResponse,
  CheckpointPlan,
  CrewAssignment,
  CrewTask,
  ExplainabilityRecord,
  IncidentCategory,
  IncidentEvent,
  IncidentSeverity,
  MergeRecord,
  MergeStrategyKind,
  GeocodeSearchResultItem,
  NavigationRoutingMode,
  PostNavigationRouteResponse,
  OpsTimelineEvent,
  PlanDelta,
  ProtocolNote,
  ProtocolNoteCategory,
  MapWorkspaceLayer,
  RaceMapWorkspace,
  RaceRoom,
  RaceRoomInvite,
  RaceRoomJoinPreview,
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

type PublicApiClientOptions = {
  baseUrl: string;
};

function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Prefer JSON `error`; append `message` when present (Fastify route 404s expose which path missed). */
function formatApiFailureMessage(status: number, parsed: unknown): string {
  if (!parsed || typeof parsed !== "object" || parsed === null) {
    return `API error ${status}`;
  }
  const o = parsed as Record<string, unknown>;
  if (!("error" in o)) {
    return `API error ${status}`;
  }
  const errPart = String(o.error);
  const msgPart = "message" in o && o.message !== undefined && o.message !== null ? String(o.message) : "";
  if (msgPart.length > 0 && msgPart !== errPart) {
    return `${errPart} — ${msgPart}`;
  }
  return errPart;
}

/** Many gateways return `{ error: "Not Found" }` without `message`; include the request we made. */
function finalizeApiFailureMessage(status: number, parsed: unknown, method: string, path: string): string {
  const message = formatApiFailureMessage(status, parsed);
  if (status === 404 && message === "Not Found") {
    return `Not Found (${method} ${path})`;
  }
  return message;
}

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
  const base = normalizeApiBaseUrl(options.baseUrl);
  const res = await fetch(`${base}${path}`, {
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
    const message = finalizeApiFailureMessage(res.status, parsed, method, path);
    throw new ApiError(res.status, parsed, message);
  }
  return parsed as T;
}

async function requestPublic<T>(options: PublicApiClientOptions, method: string, path: string): Promise<T> {
  const base = normalizeApiBaseUrl(options.baseUrl);
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Accept: "application/json" }
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const message = finalizeApiFailureMessage(res.status, parsed, method, path);
    throw new ApiError(res.status, parsed, message);
  }
  return parsed as T;
}

export type CreateRaceRoomInput = {
  teamId: string;
  athleteId: string;
  name: string;
  creatorName?: string;
  description?: string;
  crewName?: string;
  creatorRole?: "athlete" | "crew_member" | "crew_chief" | "team_manager";
};

export type ActivateRaceRoomInput = {
  eventEndsAt: string;
};

export type UpdateRaceCourseInput = {
  course: RaceCourse;
  plannedPaceSecondsPerKm: number;
  courseDistanceMeters?: number;
  courseElevationGainMeters?: number;
  courseFileName?: string;
  routeOverlayLayer?: MapWorkspaceLayer;
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

export type JoinRaceRoomByCodeInput = {
  roomCode: string;
};

export type UpdateRaceRoomMemberRoleInput = {
  role: RaceRoomInvite["role"];
};

export type UpdateRaceRoomMemberDisplayNameInput = {
  displayName: string;
};

export type PutRaceMapWorkspaceInput = {
  layers: RaceMapWorkspace["layers"];
  selectedLayerId?: string;
  drivesProjectionLayerId?: string;
  checkpoints: RaceMapWorkspace["checkpoints"];
  syncBaselineFromLayer?: boolean;
};

export type PostRoomRouteInput = {
  mode: NavigationRoutingMode;
  coordinates?: Array<{ longitude: number; latitude: number }>;
  checkpointIds?: string[];
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
    joinRaceRoomByCode: (input: JoinRaceRoomByCodeInput) =>
      request<{ room: RaceRoom; assignedRole: RaceRoomInvite["role"]; permissions: Record<string, boolean> }>(
        options,
        "POST",
        "/race-rooms/join-by-code",
        input
      ),
    updateRaceRoomMemberRole: (roomId: string, memberUserId: string, input: UpdateRaceRoomMemberRoleInput) =>
      request<{ room: RaceRoom; membership: RaceRoom["memberships"][number] }>(
        options,
        "PATCH",
        `/race-rooms/${roomId}/members/${encodeURIComponent(memberUserId)}`,
        input
      ),
    updateRaceRoomMemberDisplayName: (
      roomId: string,
      memberUserId: string,
      input: UpdateRaceRoomMemberDisplayNameInput
    ) =>
      request<{ room: RaceRoom; membership: RaceRoom["memberships"][number] }>(
        options,
        "PATCH",
        `/race-rooms/${roomId}/members/${encodeURIComponent(memberUserId)}`,
        input
      ),
    removeRaceRoomMember: (roomId: string, memberUserId: string) =>
      request<{ room: RaceRoom }>(options, "DELETE", `/race-rooms/${roomId}/members/${encodeURIComponent(memberUserId)}`),
    listMyRaceRooms: () => request<{ rooms: RaceRoom[] }>(options, "GET", "/race-rooms/mine"),
    listTeamRaceRooms: (teamId: string) =>
      request<{ rooms: RaceRoom[] }>(options, "GET", `/teams/${encodeURIComponent(teamId)}/race-rooms`),
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
      ),
    getMapWorkspace: (roomId: string) =>
      request<{ mapWorkspace: RaceMapWorkspace }>(options, "GET", `/race-rooms/${roomId}/map-workspace`),
    putMapWorkspace: (roomId: string, input: PutRaceMapWorkspaceInput) =>
      request<RaceRoom>(options, "PUT", `/race-rooms/${roomId}/map-workspace`, input),
    postRoomRoute: (roomId: string, input: PostRoomRouteInput) =>
      request<PostNavigationRouteResponse>(options, "POST", `/race-rooms/${roomId}/routing/route`, input),
    getGeocodeSearch: (roomId: string, query: string) =>
      request<{ results: GeocodeSearchResultItem[] }>(
        options,
        "GET",
        `/race-rooms/${roomId}/geocode/search?q=${encodeURIComponent(query)}`
      ),
    postAnalyticsEvents: (
      events: Array<{ name: string; properties?: Record<string, unknown>; occurredAt?: string }>
    ) => request<{ accepted: number }>(options, "POST", "/analytics/v1/events", { events }),

    // --- Crew chat (E2E) ---
    getChatStreamToken: (input?: { roomId?: string }) =>
      request<ChatStreamTokenResponse>(
        options,
        "POST",
        "/chat/stream-token",
        input?.roomId ? { roomId: input.roomId } : undefined
      ),
    registerChatDevice: (input: { deviceId: string; publicKey: string }) =>
      request<ChatDeviceKey>(options, "POST", "/chat/devices", input),
    listChatDevicesForUser: (userId: string) =>
      request<{ devices: ChatDeviceKey[] }>(
        options,
        "GET",
        `/chat/users/${encodeURIComponent(userId)}/devices`
      ),
    uploadChatKeyEnvelopes: (
      roomId: string,
      envelopes: Array<{
        recipientUserId: string;
        recipientDeviceId: string;
        senderEphemeralPublicKey: string;
        nonce: string;
        ciphertext: string;
        keyVersion: number;
      }>
    ) =>
      request<{ stored: number; envelopes: ChatKeyEnvelope[] }>(
        options,
        "POST",
        `/chat/rooms/${encodeURIComponent(roomId)}/key-envelopes`,
        { envelopes }
      ),
    listChatKeyEnvelopesForDevice: (roomId: string, deviceId: string) =>
      request<{ envelopes: ChatKeyEnvelope[]; latestRoomKeyVersion?: number }>(
        options,
        "GET",
        `/chat/rooms/${encodeURIComponent(roomId)}/key-envelopes?deviceId=${encodeURIComponent(deviceId)}`
      ),
    getChatNotificationPref: (roomId: string) =>
      request<{ preference: ChatNotificationPref; updatedAt?: string }>(
        options,
        "GET",
        `/chat/rooms/${encodeURIComponent(roomId)}/notification-prefs`
      ),
    setChatNotificationPref: (roomId: string, preference: ChatNotificationPref) =>
      request<ChatNotificationPrefRecord>(
        options,
        "POST",
        `/chat/rooms/${encodeURIComponent(roomId)}/notification-prefs`,
        { preference }
      ),
    registerChatPushToken: (input: { deviceId: string; platform: ChatPushPlatform; token: string }) =>
      request<ChatPushTokenRecord>(options, "POST", "/chat/push/tokens", input),
    deleteChatRoomMessages: (roomId: string) =>
      request<ChatRetentionResult>(
        options,
        "DELETE",
        `/chat/rooms/${encodeURIComponent(roomId)}/messages`
      )
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createPublicApiClient(options: PublicApiClientOptions) {
  return {
    getJoinPreviewByCode: (roomCode: string) =>
      requestPublic<{ preview: RaceRoomJoinPreview }>(
        { baseUrl: normalizeApiBaseUrl(options.baseUrl) },
        "GET",
        `/race-rooms/join-preview/${encodeURIComponent(roomCode.trim())}`
      )
  };
}
