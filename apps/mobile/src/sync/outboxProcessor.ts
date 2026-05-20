import type { ProtocolNote } from "@crewcue/contracts";
import type { ApiClient, AssignTaskInput, PostPingInput } from "../api/client";
import { isPendingHeartbeat } from "./pendingHeartbeatParse";
import { resolveOutboxFailure } from "./outboxPolicy";
import type { OutboxOperation } from "./outboxStore";

type OutboxPingPayload = { roomId: string } & PostPingInput;
type OutboxProtocolPayload = {
  roomId: string;
  checkpointId: string;
  category: ProtocolNote["category"];
  body: string;
};
type OutboxTaskPayload =
  | ({ roomId: string; taskId: string; action: "start" })
  | ({ roomId: string; taskId: string; action: "complete" })
  | ({ roomId: string; taskId: string; action: "assign" } & AssignTaskInput);
type OutboxCheckpointPayload =
  | {
      roomId: string;
      checkpointId: string;
      action: "manual_stop";
      arrivalAt: string;
      departureAt: string;
      note?: string;
    }
  | {
      roomId: string;
      checkpointId: string;
      action: "set_resolved_source";
      visitIndex: number;
      resolvedSource: "auto" | "manual_crew";
    };

type ProcessSingleOutboxResult = {
  roomId: string;
  label: string;
  feedback: string;
};

export type ProcessOutboxBatchResult = {
  operations: OutboxOperation[];
  processedCount: number;
  touchedRoomIds: string[];
  operatorSignal?: { label: string; feedback: string; status: OutboxOperation["status"] };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOutboxPingPayload(value: unknown): value is OutboxPingPayload {
  return (
    isRecord(value) &&
    typeof value.roomId === "string" &&
    typeof value.latitude === "number" &&
    typeof value.longitude === "number" &&
    typeof value.recordedAt === "string" &&
    (value.horizontalAccuracyMeters === undefined || typeof value.horizontalAccuracyMeters === "number") &&
    (value.uploadIntervalSeconds === undefined || typeof value.uploadIntervalSeconds === "number")
  );
}

function isOutboxProtocolPayload(value: unknown): value is OutboxProtocolPayload {
  return (
    isRecord(value) &&
    typeof value.roomId === "string" &&
    typeof value.checkpointId === "string" &&
    typeof value.category === "string" &&
    (value.category === "heat" ||
      value.category === "nutrition" ||
      value.category === "blister" ||
      value.category === "other") &&
    typeof value.body === "string"
  );
}

function isOutboxTaskPayload(value: unknown): value is OutboxTaskPayload {
  if (!isRecord(value) || typeof value.roomId !== "string" || typeof value.taskId !== "string") {
    return false;
  }

  if (value.action === "start" || value.action === "complete") {
    return true;
  }

  return (
    value.action === "assign" &&
    typeof value.assigneeUserId === "string" &&
    typeof value.assigneeRole === "string" &&
    (value.assigneeRole === "athlete" ||
      value.assigneeRole === "crew_member" ||
      value.assigneeRole === "crew_chief" ||
      value.assigneeRole === "team_manager")
  );
}

function isOutboxCheckpointPayload(value: unknown): value is OutboxCheckpointPayload {
  if (!isRecord(value) || typeof value.roomId !== "string" || typeof value.checkpointId !== "string") {
    return false;
  }
  if (
    value.action === "manual_stop" &&
    typeof value.arrivalAt === "string" &&
    typeof value.departureAt === "string"
  ) {
    return value.note === undefined || typeof value.note === "string";
  }
  return (
    value.action === "set_resolved_source" &&
    typeof value.visitIndex === "number" &&
    (value.resolvedSource === "auto" || value.resolvedSource === "manual_crew")
  );
}

export function countPendingOutboxOperations(operations: OutboxOperation[]): number {
  return operations.filter((operation) => operation.status === "pending").length;
}

export function describeOutboxOperation(operation: OutboxOperation): string {
  if (operation.type === "ping") {
    if (isPendingHeartbeat(operation.payload)) {
      return "sync heartbeat";
    }

    if (isOutboxPingPayload(operation.payload)) {
      return "athlete ping";
    }
  }

  if (operation.type === "protocol") {
    return "protocol note";
  }

  if (operation.type === "task" && isOutboxTaskPayload(operation.payload)) {
    return `task ${operation.payload.action}`;
  }

  if (operation.type === "checkpoint" && isOutboxCheckpointPayload(operation.payload)) {
    return operation.payload.action === "manual_stop" ? "checkpoint manual stop" : "checkpoint source";
  }

  return operation.type;
}

async function processOutboxOperation(
  client: ApiClient,
  operation: OutboxOperation
): Promise<ProcessSingleOutboxResult> {
  if (operation.type === "ping") {
    if (isPendingHeartbeat(operation.payload)) {
      const response = await client.postSyncHeartbeat(operation.payload.roomId, operation.payload);
      return {
        roomId: operation.payload.roomId,
        label: "sync heartbeat",
        feedback: `Sent at ${response.lastHeartbeatAt}.`
      };
    }

    if (isOutboxPingPayload(operation.payload)) {
      const { roomId, ...payload } = operation.payload;
      const response = await client.postPing(roomId, payload);
      if (response.decision === "accepted") {
        return {
          roomId,
          label: "athlete ping",
          feedback: `Accepted at ${response.recordedAt}.`
        };
      }

      return {
        roomId,
        label: "athlete ping",
        feedback: `${response.reason}: ${response.message}`
      };
    }
  }

  if (operation.type === "protocol" && isOutboxProtocolPayload(operation.payload)) {
    const { roomId, checkpointId, category, body } = operation.payload;
    await client.postProtocolNote(roomId, { checkpointId, category, body });
    return { roomId, label: "protocol note", feedback: "Sent to timeline." };
  }

  if (operation.type === "task" && isOutboxTaskPayload(operation.payload)) {
    if (operation.payload.action === "assign") {
      await client.assignTask(operation.payload.roomId, operation.payload.taskId, {
        assigneeUserId: operation.payload.assigneeUserId,
        assigneeRole: operation.payload.assigneeRole
      });
      return { roomId: operation.payload.roomId, label: "task assign", feedback: "Assignment saved." };
    }

    if (operation.payload.action === "start") {
      await client.startTask(operation.payload.roomId, operation.payload.taskId);
      return { roomId: operation.payload.roomId, label: "task start", feedback: "Task started." };
    }

    await client.completeTask(operation.payload.roomId, operation.payload.taskId);
    return { roomId: operation.payload.roomId, label: "task complete", feedback: "Task completed." };
  }

  if (operation.type === "checkpoint" && isOutboxCheckpointPayload(operation.payload)) {
    if (operation.payload.action === "manual_stop") {
      await client.postManualCheckpointStop(
        operation.payload.roomId,
        operation.payload.checkpointId,
        {
          arrivalAt: operation.payload.arrivalAt,
          departureAt: operation.payload.departureAt,
          ...(operation.payload.note ? { note: operation.payload.note } : {})
        },
        { idempotencyKey: operation.id }
      );
      return {
        roomId: operation.payload.roomId,
        label: "checkpoint manual stop",
        feedback: "Manual stop saved."
      };
    }
    await client.patchCheckpointVisitResolvedSource(
      operation.payload.roomId,
      operation.payload.checkpointId,
      operation.payload.visitIndex,
      { resolvedSource: operation.payload.resolvedSource }
    );
    return {
      roomId: operation.payload.roomId,
      label: "checkpoint source",
      feedback: "Stop source updated."
    };
  }

  throw new Error(`Unsupported outbox payload for ${operation.type}.`);
}

export async function processOutboxBatch(
  client: ApiClient,
  operations: OutboxOperation[],
  now = (): string => new Date().toISOString()
): Promise<ProcessOutboxBatchResult> {
  const nextOperations = [...operations];
  const touchedRoomIds = new Set<string>();
  let processedCount = 0;
  let operatorSignal: ProcessOutboxBatchResult["operatorSignal"];

  for (const [index, operation] of nextOperations.entries()) {
    if (operation.status !== "pending") {
      continue;
    }

    const updatedAt = now();

    try {
      const result = await processOutboxOperation(client, operation);
      nextOperations[index] = {
        ...operation,
        attempts: operation.attempts + 1,
        status: "sent",
        feedback: result.feedback,
        updatedAt
      };
      processedCount += 1;
      touchedRoomIds.add(result.roomId);
    } catch (error) {
      const resolution = resolveOutboxFailure(error);
      nextOperations[index] = {
        ...operation,
        attempts: operation.attempts + 1,
        status: resolution.status,
        feedback: resolution.feedback,
        updatedAt
      };
      operatorSignal = {
        label: describeOutboxOperation(operation),
        feedback: resolution.feedback,
        status: resolution.status
      };
      if (resolution.retryable) {
        break;
      }
    }
  }

  return {
    operations: nextOperations,
    processedCount,
    touchedRoomIds: [...touchedRoomIds],
    operatorSignal
  };
}
