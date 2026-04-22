export type PendingHeartbeat = {
  roomId: string;
  deviceId: string;
  pendingQueueCount: number;
};

export function isPendingHeartbeat(value: unknown): value is PendingHeartbeat {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const parsed = value as Partial<PendingHeartbeat>;
  return (
    typeof parsed.roomId === "string" &&
    typeof parsed.deviceId === "string" &&
    typeof parsed.pendingQueueCount === "number" &&
    Number.isInteger(parsed.pendingQueueCount) &&
    parsed.pendingQueueCount >= 0
  );
}

export function parsePendingHeartbeat(raw: string | null): PendingHeartbeat | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isPendingHeartbeat(parsed)) {
      return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
