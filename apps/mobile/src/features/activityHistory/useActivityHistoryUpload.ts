import { useCallback, useEffect, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystemLegacy from "expo-file-system/legacy";
import type { ApiClient } from "../../api/client";
import { ApiError } from "../../api/client";
import {
  ActivityGpxParseError,
  formatActivityUploadNetworkError,
  formatActivityUploadProgress,
  summarizeActivityGpxUploadBatch,
  type ActivityGpxUploadFileResult,
  type ActivityGpxUploadProgress
} from "./uploadActivityGpx";
import { buildActivityHistoryMetricsIngest } from "./buildActivityHistoryMetrics";

export type ActivityHistoryUploadState = {
  historyCount: number;
  loading: boolean;
  busy: boolean;
  error?: string;
  lastMessage?: string;
  /** Live status while busy (reading / parsing / uploading). */
  progressMessage?: string;
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

  const setProgress = useCallback(async (progress: ActivityGpxUploadProgress) => {
    setProgressMessage(formatActivityUploadProgress(progress));
    await yieldForUi();
  }, []);

  const refresh = useCallback(async () => {
    if (!client) {
      setHistoryCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const listed = await client.listActivityHistory();
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
    try {
      await setProgress({ stage: "picking" });
      const result = await DocumentPicker.getDocumentAsync({
        // iOS Files picker can hide GPX exports when MIME filters are too strict.
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true
      });

      if (result.canceled) {
        setLastMessage("Upload canceled");
        setProgressMessage(undefined);
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

          await setProgress({ stage: "parsing", fileName, fileIndex, fileCount });
          const metrics = await buildActivityHistoryMetricsIngest(gpxXml);

          await setProgress({ stage: "uploading", fileName, fileIndex, fileCount });
          const ref = await client.ingestActivityHistoryMetrics(metrics);
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
      if (summary.failedCount > 0 && summary.uploadedCount === 0) {
        setError(summary.message);
      }

      await setProgress({ stage: "refreshing" });
      await refresh();
    } catch (err) {
      setError(formatUploadError(err));
    } finally {
      setProgressMessage(undefined);
      setBusy(false);
    }
  }, [busy, client, refresh, setProgress]);

  return {
    historyCount,
    loading,
    busy,
    error,
    lastMessage,
    progressMessage,
    refresh,
    uploadGpxFiles
  };
}
