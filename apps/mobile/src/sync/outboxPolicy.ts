import { ApiError } from "../api/client";
import type { OutboxOperation, OutboxOperationStatus } from "./outboxStore";

type OutboxFailureResolution = {
  status: OutboxOperationStatus;
  retryable: boolean;
  feedback: string;
};

function readErrorField(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return undefined;
  }

  const errorValue = (body as { error: unknown }).error;
  return typeof errorValue === "string" && errorValue.length > 0 ? errorValue : undefined;
}

export function resolveOutboxFailure(error: unknown): OutboxFailureResolution {
  if (!(error instanceof ApiError)) {
    return {
      status: "pending",
      retryable: true,
      feedback: error instanceof Error ? error.message : "Network error. Will retry when the app is active."
    };
  }

  if (
    error.status === 422 &&
    typeof error.body === "object" &&
    error.body !== null &&
    "decision" in error.body &&
    (error.body as { decision?: unknown }).decision === "rejected"
  ) {
    const reason = (error.body as { reason?: unknown }).reason;
    const message = (error.body as { message?: unknown }).message;
    return {
      status: "rejected",
      retryable: false,
      feedback:
        typeof message === "string" && message.length > 0
          ? message
          : typeof reason === "string" && reason.length > 0
            ? `Rejected: ${reason.replaceAll("_", " ")}`
            : "Rejected by server policy."
    };
  }

  if (error.status === 409) {
    return {
      status: "conflict",
      retryable: false,
      feedback: readErrorField(error.body) ?? error.message
    };
  }

  if (error.status === 400 || error.status === 401 || error.status === 403 || error.status === 404) {
    return {
      status: "rejected",
      retryable: false,
      feedback: readErrorField(error.body) ?? error.message
    };
  }

  return {
    status: "pending",
    retryable: true,
    feedback: readErrorField(error.body) ?? error.message
  };
}

export function isSafeOutboxRetryCandidate(operation: OutboxOperation): boolean {
  if (operation.status !== "pending") {
    return false;
  }

  return operation.type === "ping";
}
