import {
  parseCrewScheduleSheet,
  type AthletePingAcceptedResponse,
  type AthletePingRejectedResponse,
  type ChatNotificationPref,
  type ChatNotificationPrefRecord,
  type ChatPushPlatform,
  type ChatPushTokenRecord,
  type ChatRetentionResult,
  type ChatStreamTokenResponse,
  type CheckpointPlan,
  type CrewAssignment,
  type CrewScheduleSheet,
  type CrewTask,
  type ExplainabilityRecord,
  type StopPlanNote,
  type IncidentCategory,
  type IncidentEvent,
  type IncidentSeverity,
  type MergeRecord,
  type MergeStrategyKind,
  type GeocodeSearchResultItem,
  type NavigationRoutingMode,
  type PostNavigationRouteResponse,
  type OpsTimelineEvent,
  type PlanDelta,
  type ProtocolNote,
  type ProtocolNoteCategory,
  type MapWorkspaceLayer,
  type RaceMapWorkspace,
  type RaceRoom,
  type RaceRoomInvite,
  type RaceRoomJoinPreview,
  type RaceCourse,
  type RaceRoomEntitlement,
  type RaceRoomProjection,
  type Recommendation,
  type SyncQueueDiagnostics,
  type SyncStatus
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

type RequestExtras = {
  idempotencyKey?: string;
  signal?: AbortSignal;
};

async function request<T>(
  options: ApiClientOptions,
  method: string,
  path: string,
  body?: unknown,
  extras?: RequestExtras
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    Accept: "application/json"
  };
  if (extras?.idempotencyKey) {
    headers["Idempotency-Key"] = extras.idempotencyKey;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const base = normalizeApiBaseUrl(options.baseUrl);
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: extras?.signal
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

export type UpdateRaceCourseInput = {
  course: RaceCourse;
  plannedPaceSecondsPerKm: number;
  /** Required when saving a course: official race clock anchor (ISO 8601). */
  raceStartAt: string;
  courseDistanceMeters?: number;
  courseElevationGainMeters?: number;
  courseFileName?: string;
  routeOverlayLayer?: MapWorkspaceLayer;
};

/** Note body for stop-plan upsert. Empty/whitespace body clears that notes field on the API. */
export type StopPlanNoteInput = {
  id?: string;
  body: string;
};

/**
 * Partial stop-plan upsert (PUT/PATCH). Omit fields to leave unchanged.
 * Explicit `null` clears delay or a notes field. PUT `{}` does not clear (server semantics).
 */
export type UpsertStopPlanInput = {
  delayOverrideSeconds?: number | null;
  athleteNotes?: StopPlanNoteInput | null;
  planNotes?: StopPlanNoteInput | null;
};

export type StopPlanResponse = {
  roomId: string;
  checkpointId: string;
  delayOverrideSeconds?: number;
  athleteNotes?: StopPlanNote;
  planNotes?: StopPlanNote;
};

/** Reject negative / non-finite delay before network (API also 400s). */
export function assertValidUpsertStopPlanInput(input: UpsertStopPlanInput): void {
  if (input.delayOverrideSeconds === undefined || input.delayOverrideSeconds === null) {
    return;
  }
  if (!Number.isFinite(input.delayOverrideSeconds) || input.delayOverrideSeconds < 0) {
    throw new ApiError(400, { error: "Invalid stop-plan payload" }, "Invalid stop-plan payload");
  }
}

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

/** Preflight closed check-in (both ISO times; departure after arrival). */
export function assertValidManualCheckpointStopInput(input: ManualCheckpointStopInput): void {
  const arrivalAt = typeof input.arrivalAt === "string" ? input.arrivalAt.trim() : "";
  const departureAt = typeof input.departureAt === "string" ? input.departureAt.trim() : "";
  if (!arrivalAt || !departureAt) {
    throw new ApiError(
      400,
      { error: "Invalid manual stop payload" },
      "Arrival and departure times are both required for check-in."
    );
  }
  const arrivalMs = Date.parse(arrivalAt);
  const departureMs = Date.parse(departureAt);
  if (!Number.isFinite(arrivalMs) || !Number.isFinite(departureMs)) {
    throw new ApiError(
      400,
      { error: "Invalid manual stop payload" },
      "Arrival and departure must be valid ISO-8601 times."
    );
  }
  if (departureMs <= arrivalMs) {
    throw new ApiError(
      400,
      { error: "departureAt must be after arrivalAt" },
      "Departure must be after arrival."
    );
  }
}

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
    createRaceRoom: (input: CreateRaceRoomInput, extras?: RequestExtras) =>
      request<RaceRoom>(options, "POST", "/race-rooms", input, extras),
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
    updateRaceCourse: (roomId: string, input: UpdateRaceCourseInput, extras?: RequestExtras) =>
      request<RaceRoom>(options, "PUT", `/race-rooms/${roomId}/course`, input, extras),
    postPing: (roomId: string, input: PostPingInput) =>
      request<PingResponse>(options, "POST", `/race-rooms/${roomId}/pings`, input),
    getProjection: (roomId: string) =>
      request<RaceRoomProjection>(options, "GET", `/race-rooms/${roomId}/projection`),
    /** Crew schedule sheet (clock + elapsed + dwell). Displays API values; do not recompute clocks client-side. */
    getSchedule: async (roomId: string): Promise<CrewScheduleSheet> => {
      const raw = await request<unknown>(options, "GET", `/race-rooms/${roomId}/schedule`);
      return parseCrewScheduleSheet(raw);
    },
    getStopPlan: (roomId: string, checkpointId: string) =>
      request<StopPlanResponse>(
        options,
        "GET",
        `/race-rooms/${roomId}/stop-plans/${encodeURIComponent(checkpointId)}`
      ),
    /** Partial upsert (omit = unchanged; null = clear). Prefer for edit UI. */
    patchStopPlan: async (
      roomId: string,
      checkpointId: string,
      input: UpsertStopPlanInput,
      extras?: RequestExtras
    ): Promise<StopPlanResponse> => {
      assertValidUpsertStopPlanInput(input);
      return request<StopPlanResponse>(
        options,
        "PATCH",
        `/race-rooms/${roomId}/stop-plans/${encodeURIComponent(checkpointId)}`,
        input,
        extras
      );
    },
    /** Same semantics as PATCH on the API (shared upsert handler). */
    putStopPlan: async (
      roomId: string,
      checkpointId: string,
      input: UpsertStopPlanInput,
      extras?: RequestExtras
    ): Promise<StopPlanResponse> => {
      assertValidUpsertStopPlanInput(input);
      return request<StopPlanResponse>(
        options,
        "PUT",
        `/race-rooms/${roomId}/stop-plans/${encodeURIComponent(checkpointId)}`,
        input,
        extras
      );
    },
    /** Clears the entire stop-plan overlay for the checkpoint (null/DELETE path). */
    clearStopPlan: (roomId: string, checkpointId: string, extras?: RequestExtras) =>
      request<StopPlanResponse>(
        options,
        "DELETE",
        `/race-rooms/${roomId}/stop-plans/${encodeURIComponent(checkpointId)}`,
        undefined,
        extras
      ),
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
    postManualCheckpointStop: async (
      roomId: string,
      checkpointId: string,
      input: ManualCheckpointStopInput,
      extras?: RequestExtras
    ) => {
      assertValidManualCheckpointStopInput(input);
      return request<{ checkpointSplit: RaceRoomProjection["checkpointSplits"][number] }>(
        options,
        "POST",
        `/race-rooms/${roomId}/checkpoints/${checkpointId}/manual-stop`,
        input,
        extras
      );
    },
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

    // --- Crew chat MVP plaintext ---
    getChatStreamToken: (input?: { roomId?: string }) =>
      request<ChatStreamTokenResponse>(
        options,
        "POST",
        "/chat/stream-token",
        input?.roomId ? { roomId: input.roomId } : undefined
      ),
    registerChatPushDevice: (input: { deviceId: string; platform: ChatPushPlatform; token: string }) =>
      request<ChatPushTokenRecord>(options, "POST", "/chat/devices", input),
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
      ),

    // --- Strava activity history (W3-2) ---
    startStravaOAuth: () =>
      request<{ authorizeUrl: string; state: string }>(options, "GET", "/strava/oauth/start"),
    completeStravaOAuth: (input: { code: string; state: string }) =>
      request<{ connected: boolean; athleteId: string }>(
        options,
        "POST",
        "/strava/oauth/callback",
        input
      ),
    getStravaConnection: () =>
      request<{ connected: boolean; athleteId?: string }>(options, "GET", "/strava/connection"),
    syncStravaActivities: () =>
      request<{ syncedCount: number; createdCount: number; items: unknown[] }>(
        options,
        "POST",
        "/strava/sync"
      ),
    disconnectStrava: () =>
      request<{ connected: boolean }>(options, "DELETE", "/strava/connection")
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
