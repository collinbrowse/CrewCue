import { useCallback, useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import type { ApiClient } from "../../api/client";
import { ApiError } from "../../api/client";
import { parseStravaOAuthCallbackUrl } from "./stravaOAuth";

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
    let connectError: string | undefined;
    try {
      const start = await client.startStravaOAuth();
      const redirectUri = start.redirectUri?.trim();
      if (!redirectUri) {
        connectError = "Strava redirect URI missing from API";
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(start.authorizeUrl, redirectUri);
      if (result.type !== "success" || !("url" in result) || !result.url) {
        if (result.type === "cancel" || result.type === "dismiss") {
          connectError =
            "Strava sign-in was cancelled. If you approved in the browser but landed on an error page, check STRAVA_REDIRECT_URI matches your Strava app callback domain.";
          return;
        }
        connectError = "Strava sign-in did not complete";
        return;
      }
      const params = parseStravaOAuthCallbackUrl(result.url);
      if (!params) {
        connectError = `Strava callback was missing code or state (${result.url})`;
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
      connectError =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to connect Strava";
    } finally {
      setBusy(false);
      if (connectError) {
        setError(connectError);
      } else {
        await refresh();
      }
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
