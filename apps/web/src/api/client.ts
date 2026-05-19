import type {
  GeocodeSearchResultItem,
  MapWorkspaceLayer,
  RaceCourse,
  RaceMapWorkspace,
  RaceRoom
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

type WebApiClientOptions = {
  baseUrl: string;
  accessToken: string;
};

export type PutRaceMapWorkspaceInput = {
  layers: RaceMapWorkspace["layers"];
  selectedLayerId?: string;
  drivesProjectionLayerId?: string;
  checkpoints: RaceMapWorkspace["checkpoints"];
  syncBaselineFromLayer?: boolean;
};

export type UpdateRaceCourseWebInput = {
  course: RaceCourse;
  plannedPaceSecondsPerKm: number;
  raceStartAt: string;
  courseDistanceMeters?: number;
  courseElevationGainMeters?: number;
  courseFileName?: string;
  routeOverlayLayer?: MapWorkspaceLayer;
};

type RequestExtras = {
  idempotencyKey?: string;
};

async function request<T>(
  options: WebApiClientOptions,
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
  const res = await fetch(`${options.baseUrl.replace(/\/$/, "")}${path}`, {
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

export function createWebApiClient(options: WebApiClientOptions) {
  return {
    updateRaceCourse: (roomId: string, input: UpdateRaceCourseWebInput, extras?: RequestExtras) =>
      request<RaceRoom>(options, "PUT", `/race-rooms/${roomId}/course`, input, extras),
    getMapWorkspace: (roomId: string) =>
      request<{ mapWorkspace: RaceMapWorkspace }>(options, "GET", `/race-rooms/${roomId}/map-workspace`),
    putMapWorkspace: (roomId: string, input: PutRaceMapWorkspaceInput) =>
      request<RaceRoom>(options, "PUT", `/race-rooms/${roomId}/map-workspace`, input),
    getGeocodeSearch: (roomId: string, query: string) =>
      request<{ results: GeocodeSearchResultItem[] }>(
        options,
        "GET",
        `/race-rooms/${roomId}/geocode/search?q=${encodeURIComponent(query)}`
      ),
    postAnalyticsEvents: (
      events: Array<{ name: string; properties?: Record<string, unknown>; occurredAt?: string }>
    ) => request<{ accepted: number }>(options, "POST", "/analytics/v1/events", { events })
  };
}
