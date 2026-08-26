/**
 * Helpers for athlete activity GPX upload → shared ActivityHistoryRef store.
 */

export type ActivityGpxFileInput = {
  fileName: string;
  gpxXml: string;
};

export type ActivityGpxUploadFileResult =
  | { fileName: string; ok: true; historyId: string; created: boolean }
  | { fileName: string; ok: false; message: string };

export type ActivityGpxUploadBatchSummary = {
  uploadedCount: number;
  failedCount: number;
  message: string;
  results: ActivityGpxUploadFileResult[];
};

/** Build a short status line after a multi-file upload attempt. */
export function summarizeActivityGpxUploadBatch(
  results: ActivityGpxUploadFileResult[]
): ActivityGpxUploadBatchSummary {
  const uploadedCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - uploadedCount;
  const parts: string[] = [];
  if (uploadedCount > 0) {
    parts.push(
      `Uploaded ${uploadedCount} activit${uploadedCount === 1 ? "y" : "ies"}`
    );
  }
  if (failedCount > 0) {
    const firstFail = results.find((r) => !r.ok);
    parts.push(
      failedCount === 1 && firstFail && !firstFail.ok
        ? `${firstFail.fileName}: ${firstFail.message}`
        : `${failedCount} failed`
    );
  }
  if (parts.length === 0) {
    parts.push("No files uploaded");
  }
  return {
    uploadedCount,
    failedCount,
    message: parts.join(" · "),
    results
  };
}

/** True when XML looks like a GPX document (lightweight client-side guard). */
export function looksLikeGpxXml(contents: string): boolean {
  return /<gpx[\s>]/i.test(contents.trim());
}
