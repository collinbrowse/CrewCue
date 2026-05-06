export type CheckpointEtaRow = {
  checkpointId: string;
  distanceMetersFromStart: number;
  secondsFromStart: number;
  etaMs: number;
};

export function secondsForDistance(distanceMeters: number, paceSecondsPerKm: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return 0;
  }
  if (!Number.isFinite(paceSecondsPerKm) || paceSecondsPerKm <= 0) {
    return 0;
  }
  return (distanceMeters / 1000) * paceSecondsPerKm;
}

export function formatEtaClock(etaMs: number): string {
  if (!Number.isFinite(etaMs) || etaMs <= 0) {
    return "--";
  }
  return new Date(etaMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatRemainingMinutes(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}H ${minutes}M` : `${minutes}M`;
}
