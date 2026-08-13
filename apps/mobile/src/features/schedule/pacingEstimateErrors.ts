import { getErrorMessage, mapApiError } from "@crewcue/platform-client";
import { ApiError } from "../../api/client";

const ESTIMATE_400_MESSAGES: Record<string, string> = {
  course_missing: "Add a course before requesting a pacing estimate.",
  course_incomplete: "Course checkpoints need distances before a pacing estimate can be built.",
  "Invalid pacing estimate": "Couldn't build a pacing estimate. Check course setup and try again.",
  "raceStartAt": "Set a race start time before requesting a pacing estimate."
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
 * Map pacing-estimate request failures to crew-facing copy (EC2/EC3/EC4).
 * Auth/offline reuse catalog patterns; 400s stay setup-oriented.
 */
export function mapPacingEstimateError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return mapApiError(error).message;
    }
    if (error.status === 402) {
      return "This race room needs an active entitlement before pacing estimates are available.";
    }
    if (error.status === 400) {
      const text = readApiErrorText(error);
      for (const [needle, message] of Object.entries(ESTIMATE_400_MESSAGES)) {
        if (text.includes(needle)) {
          return message;
        }
      }
      return ESTIMATE_400_MESSAGES["Invalid pacing estimate"]!;
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
