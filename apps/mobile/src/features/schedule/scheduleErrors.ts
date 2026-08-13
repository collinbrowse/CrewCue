import { getErrorMessage, mapApiError } from "@crewcue/platform-client";
import { ApiError } from "../../api/client";

const SCHEDULE_400_MESSAGES: Record<string, string> = {
  "Course required for schedule": "Add a course before viewing the crew schedule.",
  "raceStartAt required for schedule": "Set a race start time before viewing the crew schedule.",
  "plannedPaceSecondsPerKm required for schedule": "Set a planned pace before viewing the crew schedule.",
  "Checkpoint distances required for schedule": "Course checkpoints need distances before a schedule can be built.",
  "Unable to project schedule": "Couldn't build the crew schedule. Check course setup and try again."
};

function readApiErrorText(error: ApiError): string {
  const body = error.body;
  if (body && typeof body === "object" && body !== null && "error" in body) {
    const err = (body as { error?: unknown }).error;
    if (typeof err === "string" && err.length > 0) {
      return err;
    }
  }
  return error.message;
}

/**
 * Map schedule GET failures to crew-facing copy.
 * 400 schedule prerequisites use clear setup messages; auth/offline reuse catalog patterns.
 */
export function mapScheduleFetchError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return mapApiError(error).message;
    }
    if (error.status === 402) {
      return "This race room needs an active entitlement before the schedule is available.";
    }
    if (error.status === 400) {
      const text = readApiErrorText(error);
      for (const [needle, message] of Object.entries(SCHEDULE_400_MESSAGES)) {
        if (text.includes(needle)) {
          return message;
        }
      }
      return SCHEDULE_400_MESSAGES["Unable to project schedule"]!;
    }
  }
  const mapped = mapApiError(error, "fetchFailed");
  if (mapped.key === "networkOffline") {
    return mapped.message;
  }
  if (mapped.key === "forbidden" || mapped.key === "notFound") {
    return mapped.message;
  }
  return getErrorMessage("fetchFailed");
}
