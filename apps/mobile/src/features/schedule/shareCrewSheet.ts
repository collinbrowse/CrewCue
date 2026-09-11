import { Share } from "react-native";

export type ShareCrewSheetResult =
  | { ok: true; action: string | undefined }
  | { ok: false; reason: "unavailable" | "dismissed" | "error"; message?: string };

/**
 * Present the system share sheet with the offline plaintext snapshot.
 * Callers must pass text from `buildCrewSheetExportText` (already captured).
 */
export async function shareCrewSheetText(message: string): Promise<ShareCrewSheetResult> {
  try {
    const result = await Share.share({
      message,
      title: "CrewCue crew sheet"
    });
    if (result.action === Share.dismissedAction) {
      return { ok: false, reason: "dismissed" };
    }
    return { ok: true, action: result.action };
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "Share failed";
    return { ok: false, reason: "error", message: messageText };
  }
}
