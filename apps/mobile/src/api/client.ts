import type {
  AthletePingAcceptedResponse,
  AthletePingRejectedResponse,
  CheckpointPlan,
  CrewAssignment,
  CrewTask,
  OpsTimelineEvent,
  ProtocolNote,
  ProtocolNoteCategory,
  RaceRoom,
  RaceRoomEntitlement,
  RaceRoomProjection,
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
    activateRaceRoom: (roomId: string, input: ActivateRaceRoomInput) =>
      request<RaceRoom>(options, "POST", `/race-rooms/${roomId}/activate`, input),
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
    postProtocolNote: (
      roomId: string,
      input: { checkpointId: string; category: ProtocolNoteCategory; body: string }
    ) => request<{ protocolNote: ProtocolNote }>(options, "POST", `/race-rooms/${roomId}/protocol-notes`, input),
    getTimeline: (roomId: string) =>
      request<{ events: OpsTimelineEvent[] }>(options, "GET", `/race-rooms/${roomId}/timeline`)
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
