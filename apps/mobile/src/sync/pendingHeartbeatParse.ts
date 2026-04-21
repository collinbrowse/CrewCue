export type PendingHeartbeat = {
  roomId: string;
  deviceId: string;
  pendingQueueCount: number;
};

export function parsePendingHeartbeat(raw: string | null): PendingHeartbeat | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.roomId === "string" &&
      typeof parsed.deviceId === "string" &&
      typeof parsed.pendingQueueCount === "number" &&
      Number.isInteger(parsed.pendingQueueCount) &&
      parsed.pendingQueueCount >= 0
    ) {
      return {
        roomId: parsed.roomId,
        deviceId: parsed.deviceId,
        pendingQueueCount: parsed.pendingQueueCount
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}
