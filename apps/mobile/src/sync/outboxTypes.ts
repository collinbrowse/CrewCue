export type OutboxOperationType = "ping" | "task" | "protocol" | "checkpoint";
export type OutboxOperationStatus = "pending" | "sent" | "rejected" | "conflict";

export type OutboxOperation = {
  id: string;
  type: OutboxOperationType;
  payload: any;
  attempts: number;
  status: OutboxOperationStatus;
  feedback?: string;
  updatedAt?: string;
  /** When set, a new pending op with the same key replaces the previous pending op. */
  conflictKey?: string;
};
