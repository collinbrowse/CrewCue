import { ApiError, type ManualCheckpointStopInput } from "../../api/client";
import { assertValidManualCheckpointStopInput } from "../../api/client";

export type CheckInFieldValues = {
  arrivalAt: string;
  departureAt: string;
};

export type CheckInValidationResult =
  | { ok: true; input: ManualCheckpointStopInput }
  | { ok: false; message: string };

/**
 * Client-side closed check-in validation (mirrors POST /manual-stop).
 * Both arrival and departure are required; departure must be after arrival.
 */
export function validateClosedCheckIn(fields: CheckInFieldValues): CheckInValidationResult {
  try {
    assertValidManualCheckpointStopInput({
      arrivalAt: fields.arrivalAt,
      departureAt: fields.departureAt
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, message: err.message };
    }
    return { ok: false, message: "Couldn't validate check-in times." };
  }
  const arrivalMs = Date.parse(fields.arrivalAt.trim());
  const departureMs = Date.parse(fields.departureAt.trim());
  return {
    ok: true,
    input: {
      arrivalAt: new Date(arrivalMs).toISOString(),
      departureAt: new Date(departureMs).toISOString()
    }
  };
}

/** Actual stop seconds for a closed visit (departure − arrival). */
export function closedCheckInActualStopSeconds(input: ManualCheckpointStopInput): number {
  assertValidManualCheckpointStopInput(input);
  return (Date.parse(input.departureAt) - Date.parse(input.arrivalAt)) / 1000;
}
