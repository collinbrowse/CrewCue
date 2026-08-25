import { useCallback, useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import type { ApiClient } from "../../api/client";
import { ApiError } from "../../api/client";
import { parseStravaOAuthCallbackUrl, STRAVA_REDIRECT_URI } from "./stravaOAuth";

WebBrowser.maybeCompleteAuthSession();

export type StravaConnectionState = {
  connected: boolean;
  athleteId?: string;
  loading: boolean;
  busy: boolean;
  error?: string;
  lastSyncMessage?: string;
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  sync: () => Promise<void>;
  disconnect: () => Promise<void>;
};

export function useStravaConnection(client: ApiClient | undefined): StravaConnectionState {
  const [connected, setConnected] = useState(false);
  const [athleteId, setAthleteId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [lastSyncMessage, setLastSyncMessage] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!client) {
      setConnected(false);
      setAthleteId(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const status = await client.getStravaConnection();
      setConnected(status.connected);
      setAthleteId(status.athleteId);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to load Strava connection";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(async () => {
    if (!client || busy) return;
    setBusy(true);
    setError(undefined);
    setLastSyncMessage(undefined);
    try {
      const { authorizeUrl } = await client.startStravaOAuth();
      const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, STRAVA_REDIRECT_URI);
      if (result.type !== "success" || !("url" in result) || !result.url) {
        if (result.type === "cancel" || result.type === "dismiss") {
          setError(undefined);
          return;
        }
        setError("Strava sign-in did not complete");
        return;
      }
      const params = parseStravaOAuthCallbackUrl(result.url);
      if (!params) {
        setError("Strava callback was missing code or state");
        return;
      }
      const status = await client.completeStravaOAuth(params);
      setConnected(status.connected);
      setAthleteId(status.athleteId);
      const syncResult = await client.syncStravaActivities();
      setLastSyncMessage(
        `Synced ${syncResult.syncedCount} activit${syncResult.syncedCount === 1 ? "y" : "ies"} (${syncResult.createdCount} new)`
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to connect Strava";
      setError(message);
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [busy, client, refresh]);

  const sync = useCallback(async () => {
    if (!client || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const syncResult = await client.syncStravaActivities();
      setLastSyncMessage(
        `Synced ${syncResult.syncedCount} activit${syncResult.syncedCount === 1 ? "y" : "ies"} (${syncResult.createdCount} new)`
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to sync Strava";
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [busy, client]);

  const disconnect = useCallback(async () => {
    if (!client || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await client.disconnectStrava();
      setConnected(false);
      setAthleteId(undefined);
      setLastSyncMessage(undefined);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to disconnect Strava";
      setError(message);
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [busy, client, refresh]);

  return {
    connected,
    athleteId,
    loading,
    busy,
    error,
    lastSyncMessage,
    refresh,
    connect,
    sync,
    disconnect
  };
}
