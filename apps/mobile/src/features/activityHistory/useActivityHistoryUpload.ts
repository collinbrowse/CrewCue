import { useCallback, useEffect, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystemLegacy from "expo-file-system/legacy";
import type { ApiClient } from "../../api/client";
import { ApiError } from "../../api/client";
import {
  ActivityGpxParseError,
  formatActivityUploadNetworkError,
  summarizeActivityGpxUploadBatch,
  type ActivityGpxUploadFileResult
} from "./uploadActivityGpx";
import { buildActivityHistoryMetricsIngest } from "./buildActivityHistoryMetrics";

export type ActivityHistoryUploadState = {
  historyCount: number;
  loading: boolean;
  busy: boolean;
  error?: string;
  lastMessage?: string;
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

export function useActivityHistoryUpload(client: ApiClient | undefined): ActivityHistoryUploadState {
  const [historyCount, setHistoryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [lastMessage, setLastMessage] = useState<string | undefined>(undefined);

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
      const result = await DocumentPicker.getDocumentAsync({
        // iOS Files picker can hide GPX exports when MIME filters are too strict.
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true
      });

      if (result.canceled) {
        setLastMessage("Upload canceled");
        return;
      }

      const fileResults: ActivityGpxUploadFileResult[] = [];
      for (const asset of result.assets) {
        const fileName = asset.name || "activity.gpx";
        try {
          const gpxXml = await FileSystemLegacy.readAsStringAsync(asset.uri);
          const metrics = await buildActivityHistoryMetricsIngest(gpxXml);
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
      await refresh();
    } catch (err) {
      setError(formatUploadError(err));
    } finally {
      setBusy(false);
    }
  }, [busy, client, refresh]);

  return {
    historyCount,
    loading,
    busy,
    error,
    lastMessage,
    refresh,
    uploadGpxFiles
  };
}
