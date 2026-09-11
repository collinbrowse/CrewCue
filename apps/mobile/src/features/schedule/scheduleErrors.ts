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
    if (error.status === 503) {
      return "Crew schedule is temporarily unavailable. Pull to refresh in a moment.";
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

/**
 * Map stop-plan write failures to crew-facing copy.
 * Invalid delay stays explicit; auth/entitlement reuse catalog patterns.
 */
export function mapStopPlanWriteError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return mapApiError(error).message;
    }
    if (error.status === 402) {
      return "This race room needs an active entitlement before stop plans can be edited.";
    }
    if (error.status === 400) {
      const text = readApiErrorText(error);
      if (text.includes("Invalid stop-plan payload")) {
        return "Delay must be zero or a positive number of seconds. Notes were not saved.";
      }
      return text.length > 0 ? text : "Couldn't save the stop plan. Check your inputs and try again.";
    }
  }
  const mapped = mapApiError(error, "unknown");
  if (mapped.key === "networkOffline") {
    return mapped.message;
  }
  return mapped.message;
}

/**
 * Map manual-stop / check-in write failures to crew-facing copy.
 * Client validation and API 400s stay explicit; auth/offline reuse catalog patterns.
 */
export function mapManualStopWriteError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return mapApiError(error).message;
    }
    if (error.status === 402) {
      return "This race room needs an active entitlement before check-in can be saved.";
    }
    if (error.status === 409) {
      return "Check-in isn't available until the race room is active and projection is ready.";
    }
    if (error.status === 400) {
      const text = readApiErrorText(error);
      if (text.includes("departureAt must be after arrivalAt") || text.includes("Departure must be after")) {
        return "Departure must be after arrival.";
      }
      if (text.includes("Invalid manual stop payload")) {
        return "Arrival and departure times are both required for check-in.";
      }
      return text.length > 0 ? text : "Couldn't save check-in. Check arrival and departure times.";
    }
  }
  const mapped = mapApiError(error, "unknown");
  if (mapped.key === "networkOffline") {
    return mapped.message;
  }
  return mapped.message;
}
