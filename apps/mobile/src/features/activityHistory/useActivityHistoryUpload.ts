import { useCallback, useEffect, useRef, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystemLegacy from "expo-file-system/legacy";
import type { ApiClient } from "../../api/client";
import { ApiError } from "../../api/client";
import {
  ActivityGpxParseError,
  activityUploadProgressRatio,
  formatActivityUploadNetworkError,
  formatActivityUploadProgress,
  summarizeActivityGpxUploadBatch,
  type ActivityGpxUploadFileResult,
  type ActivityGpxUploadProgress
} from "./uploadActivityGpx";
import {
  buildActivityHistoryMetricsIngest,
  fingerprintGpxExternalId
} from "./buildActivityHistoryMetrics";

export type ActivityHistoryUploadState = {
  historyCount: number;
  loading: boolean;
  busy: boolean;
  error?: string;
  lastMessage?: string;
  /** Live status while busy (reading / parsing / uploading). */
  progressMessage?: string;
  /** 0..1 determinate bar while busy. */
  progressRatio?: number;
  refresh: () => Promise<void>;
  uploadGpxFiles: () => Promise<void>;
};

function formatUploadError(err: unknown): string {
  const network = formatActivityUploadNetworkError(err);
  if (network) return network;
  if (err instanceof ActivityGpxParseError) {
    return err.message;
  }
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unable to upload activity GPX";
}

/** Let React paint status text between heavy sync steps. */
function yieldForUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function useActivityHistoryUpload(client: ApiClient | undefined): ActivityHistoryUploadState {
  const [historyCount, setHistoryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [lastMessage, setLastMessage] = useState<string | undefined>(undefined);
  const [progressMessage, setProgressMessage] = useState<string | undefined>(undefined);
  const [progressRatio, setProgressRatio] = useState<number | undefined>(undefined);
  /** externalId → history id for duplicate short-circuit (skip parse). */
  const historyByExternalIdRef = useRef<Map<string, string>>(new Map());

  const setProgress = useCallback(async (progress: ActivityGpxUploadProgress) => {
    setProgressMessage(formatActivityUploadProgress(progress));
    setProgressRatio(activityUploadProgressRatio(progress));
    await yieldForUi();
  }, []);

  const clearProgress = useCallback(() => {
    setProgressMessage(undefined);
    setProgressRatio(undefined);
  }, []);

  const refresh = useCallback(async () => {
    if (!client) {
      setHistoryCount(0);
      historyByExternalIdRef.current = new Map();
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const listed = await client.listActivityHistory();
      const byExternalId = new Map<string, string>();
      for (const item of listed.items) {
        if (item.externalId && item.id) {
          byExternalId.set(item.externalId, item.id);
        }
      }
      historyByExternalIdRef.current = byExternalId;
      setHistoryCount(listed.items.length);
      setError(undefined);
    } catch (err) {
      setError(formatUploadError(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uploadGpxFiles = useCallback(async () => {
    if (!client || busy) return;
    setBusy(true);
    setError(undefined);
    setLastMessage(undefined);
    clearProgress();
    try {
      // Do not show the progress bar until the Files picker dismisses with selections.
      const result = await DocumentPicker.getDocumentAsync({
        // iOS Files picker can hide GPX exports when MIME filters are too strict.
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true
      });

      if (result.canceled) {
        setLastMessage("Upload canceled");
        clearProgress();
        return;
      }

      const assets = result.assets;
      const fileCount = assets.length;
      const fileResults: ActivityGpxUploadFileResult[] = [];

      for (let i = 0; i < assets.length; i += 1) {
        const asset = assets[i]!;
        const fileName = asset.name || "activity.gpx";
        const fileIndex = i + 1;
        try {
          await setProgress({ stage: "reading", fileName, fileIndex, fileCount });
          const gpxXml = await FileSystemLegacy.readAsStringAsync(asset.uri);
          const trimmed = gpxXml.replace(/^\uFEFF/, "").trim();
          const externalId = await fingerprintGpxExternalId(trimmed);
          const existingId = historyByExternalIdRef.current.get(externalId);
          if (existingId) {
            fileResults.push({
              fileName,
              ok: true,
              historyId: existingId,
              created: false,
              skippedDuplicate: true
            });
            // Advance bar as if this file finished without parsing.
            await setProgress({
              stage: "uploading",
              fileName,
              fileIndex,
              fileCount,
              stageRatio: 1
            });
            continue;
          }

          await setProgress({ stage: "parsing", fileName, fileIndex, fileCount, stageRatio: 0 });
          let lastParsePct = -1;
          const metrics = await buildActivityHistoryMetricsIngest(gpxXml, {
            externalId,
            onProgress: async (stageRatio) => {
              const pct = Math.round(stageRatio * 100);
              if (pct === lastParsePct) return;
              lastParsePct = pct;
              await setProgress({
                stage: "parsing",
                fileName,
                fileIndex,
                fileCount,
                stageRatio
              });
            }
          });

          await setProgress({ stage: "uploading", fileName, fileIndex, fileCount });
          const ref = await client.ingestActivityHistoryMetrics(metrics);
          historyByExternalIdRef.current.set(externalId, ref.id);
          fileResults.push({
            fileName,
            ok: true,
            historyId: ref.id,
            created: true
          });
        } catch (err) {
          fileResults.push({ fileName, ok: false, message: formatUploadError(err) });
        }
      }

      const summary = summarizeActivityGpxUploadBatch(fileResults);
      setLastMessage(summary.message);
      if (summary.failedCount > 0 && summary.uploadedCount === 0 && summary.skippedCount === 0) {
        setError(summary.message);
      }

      await setProgress({ stage: "refreshing" });
      await refresh();
    } catch (err) {
      setError(formatUploadError(err));
    } finally {
      clearProgress();
      setBusy(false);
    }
  }, [busy, clearProgress, client, refresh, setProgress]);

  return {
    historyCount,
    loading,
    busy,
    error,
    lastMessage,
    progressMessage,
    progressRatio,
    refresh,
    uploadGpxFiles
  };
}
