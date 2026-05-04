import { Camera, GeoJSONSource, Layer, Map, OfflineManager } from "@maplibre/maplibre-react-native";
import NetInfo from "@react-native-community/netinfo";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NavigationRouteResult, NavigationRoutingMode } from "@crewcue/contracts";
import { emitAnalytics } from "../analytics/track";
import { ApiError, createApiClient } from "../api/client";
import { DSButton } from "../design-system";
import { corridorBoundsFromRouteAndCheckpoints, estimateTilesForBounds } from "../features/maps/offlineCorridor";
import { mobileMapStyleUrl } from "../features/maps/mapStyleUrl";
import { getOfflineMapsUnlocked } from "../preferences/offlineMaps";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function NavigateScreenNative(): ReactElement {
  const shell = useAuthedShell();
  const roomId = shell.room?.id;
  const token = shell.auth.status === "authenticated" ? shell.auth.accessToken : undefined;

  const [online, setOnline] = useState(true);
  const [mode, setMode] = useState<NavigationRoutingMode>("drive");
  const [route, setRoute] = useState<NavigationRouteResult | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [stepIndex, setStepIndex] = useState(0);
  const [bannerLogged, setBannerLogged] = useState(false);
  const [entitled, setEntitled] = useState(false);
  const [packBusy, setPackBusy] = useState(false);

  const checkpoints =
    shell.room?.mapWorkspace?.checkpoints?.length && shell.room.mapWorkspace.checkpoints.length > 0
      ? shell.room.mapWorkspace.checkpoints
      : shell.room?.course?.checkpoints ?? [];

  const canRoute = checkpoints.length >= 2;

  useEffect(() => {
    void getOfflineMapsUnlocked().then(setEntitled);
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const next = Boolean(state.isConnected && state.isInternetReachable !== false);
      setOnline(next);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (online || !route || bannerLogged) {
      return;
    }
    setBannerLogged(true);
    void emitAnalytics({
      baseUrl: shell.baseUrl,
      accessToken: token,
      event: "nav_offline_banner_shown",
      properties: { context: "navigate" }
    });
  }, [online, route, bannerLogged, shell.baseUrl, token]);

  useEffect(() => {
    if (!online || !route?.steps.length) {
      return;
    }
    const id = setInterval(() => {
      setStepIndex((index) => Math.min(index + 1, route.steps.length - 1));
    }, 12_000);
    return () => clearInterval(id);
  }, [online, route?.steps.length]);

  const routeFeature = useMemo(() => {
    if (!route) {
      return null;
    }
    return {
      type: "Feature",
      properties: {},
      geometry: route.geometry
    } as const;
  }, [route]);

  const center = useMemo(() => {
    const coords = route?.geometry.coordinates;
    if (!coords || coords.length === 0) {
      return [-98.5795, 39.8283] as [number, number];
    }
    const mid = coords[Math.floor(coords.length / 2)]!;
    return [mid[0], mid[1]] as [number, number];
  }, [route?.geometry.coordinates]);

  const fetchRoute = async (options?: { isReroute?: boolean }) => {
    if (!roomId || !token || !canRoute) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const client = createApiClient({ baseUrl: shell.baseUrl, accessToken: token });
      const start = checkpoints[0]!;
      const end = checkpoints[checkpoints.length - 1]!;
      const res = await client.postRoomRoute(roomId, {
        mode,
        coordinates: [
          { longitude: start.longitude, latitude: start.latitude },
          { longitude: end.longitude, latitude: end.latitude }
        ]
      });
      setRoute(res.route);
      setStepIndex(0);
      if (!options?.isReroute) {
        await emitAnalytics({
          baseUrl: shell.baseUrl,
          accessToken: token,
          event: "nav_started",
          properties: {
            mode,
            destination_type: "checkpoint",
            distance_km: Math.round((res.route.distanceMeters / 1000) * 100) / 100
          }
        });
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.body && typeof err.body === "object" && err.body !== null) {
        const message = "error" in err.body ? String((err.body as { error: string }).error) : err.message;
        setError(message);
        if (mode === "hike") {
          setError(
            `${message} Try Drive mode to the nearest access point, change the destination, or plan manually on the map workspace.`
          );
        }
      } else {
        setError(err instanceof Error ? err.message : "Routing failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const reroute = async () => {
    if (!online) {
      await emitAnalytics({
        baseUrl: shell.baseUrl,
        accessToken: token,
        event: "nav_reroute",
        properties: { online_only: false, outcome: "blocked_offline" }
      });
      return;
    }
    await emitAnalytics({
      baseUrl: shell.baseUrl,
      accessToken: token,
      event: "nav_reroute",
      properties: { online_only: true, outcome: "requested" }
    });
    await fetchRoute({ isReroute: true });
    await emitAnalytics({
      baseUrl: shell.baseUrl,
      accessToken: token,
      event: "nav_reroute",
      properties: { online_only: true, outcome: "completed" }
    });
  };

  const downloadCorridorPack = async () => {
    if (!route || !entitled || packBusy) {
      return;
    }
    const bounds = corridorBoundsFromRouteAndCheckpoints(route, checkpoints);
    const minZoom = 10;
    const maxZoom = 14;
    const est = estimateTilesForBounds(bounds, minZoom, maxZoom);
    const areaKm = Math.abs(bounds[2] - bounds[0]) * Math.abs(bounds[3] - bounds[1]) * 111 * 111;
    await emitAnalytics({
      baseUrl: shell.baseUrl,
      accessToken: token,
      event: "offline_download_requested",
      properties: {
        bbox_area_sq_km: Math.round(areaKm),
        min_zoom: minZoom,
        max_zoom: maxZoom,
        style_id: "outdoor_or_demo",
        estimated_tile_count: est,
        corridor_width: 0.12,
        checkpoint_count: checkpoints.length
      }
    });
    setPackBusy(true);
    const started = Date.now();
    try {
      await OfflineManager.createPack(
        {
          mapStyle: mobileMapStyleUrl(),
          bounds,
          minZoom,
          maxZoom,
          metadata: { roomId }
        },
        () => {},
        async () => {
          await emitAnalytics({
            baseUrl: shell.baseUrl,
            accessToken: token,
            event: "offline_download_failed",
            properties: { duration_ms: Date.now() - started, error_code: "pack_error" }
          });
        }
      );
      await emitAnalytics({
        baseUrl: shell.baseUrl,
        accessToken: token,
        event: "offline_download_completed",
        properties: { duration_ms: Date.now() - started }
      });
    } finally {
      setPackBusy(false);
    }
  };

  if (!roomId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body}>Select a race room to use navigation.</Text>
      </View>
    );
  }

  if (!canRoute) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body}>Add at least two checkpoints in the map workspace before navigating.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {!online && route ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Offline: rerouting unavailable</Text>
        </View>
      ) : null}

      <View style={styles.mapWrap}>
        <Map style={styles.map} mapStyle={mobileMapStyleUrl()}>
          <Camera zoom={route ? 11 : 3} center={center} duration={200} />
          {routeFeature ? (
            <GeoJSONSource id="nav-route" data={routeFeature}>
              <Layer id="nav-route-line" type="line" style={{ lineColor: "#a855f7", lineWidth: 5, lineOpacity: 0.9 }} />
            </GeoJSONSource>
          ) : null}
        </Map>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ paddingBottom: 32 }}>
        <Text style={styles.title}>Mode</Text>
        <View style={styles.row}>
          <DSButton preset={mode === "drive" ? "primary" : "secondary"} onPress={() => setMode("drive")}>
            Drive
          </DSButton>
          <DSButton preset={mode === "hike" ? "primary" : "secondary"} onPress={() => setMode("hike")}>
            Hike
          </DSButton>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.row}>
          <DSButton preset="primary" onPress={() => void fetchRoute()} disabled={busy}>
            {busy ? "Routing…" : "Compute route"}
          </DSButton>
          <DSButton preset="secondary" onPress={() => void reroute()} disabled={busy || !route}>
            Reroute
          </DSButton>
        </View>

        {route ? (
          <>
            <Text style={styles.title}>
              ETA ~{Math.round(route.durationSeconds / 60)} min · {(route.distanceMeters / 1000).toFixed(1)} km
            </Text>
            <Text style={styles.subtitle}>
              Step {stepIndex + 1} / {route.steps.length}
              {!online ? " · frozen offline progression" : ""}
            </Text>
            {route.steps.map((step, index) => (
              <Text
                key={`${step.instruction}-${index}`}
                style={index === stepIndex ? styles.stepActive : styles.step}
              >
                {index + 1}. {step.instruction}
              </Text>
            ))}

            <Text style={styles.title}>Offline corridor</Text>
            <Text style={styles.body}>
              {entitled
                ? "Download tiles for this route corridor (subject to fair-use limits later)."
                : "Unlock offline downloads in Settings to cache this corridor."}
            </Text>
            <DSButton preset="secondary" onPress={() => void downloadCorridorPack()} disabled={!entitled || packBusy}>
              {packBusy ? "Downloading…" : "Download offline corridor"}
            </DSButton>
          </>
        ) : (
          <Text style={styles.body}>Compute a route between your first and last checkpoints.</Text>
        )}

        {busy ? <ActivityIndicator /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  mapWrap: { height: 260 },
  map: { flex: 1 },
  panel: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  title: { color: "#e2e8f0", fontWeight: "700", marginTop: 12 },
  subtitle: { color: "#94a3b8", marginBottom: 8 },
  body: { color: "#cbd5e1", marginTop: 8 },
  row: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  step: { color: "#94a3b8", marginBottom: 4 },
  stepActive: { color: "#fdba74", fontWeight: "700", marginBottom: 4 },
  error: { color: "#fca5a5", marginTop: 8 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#0f172a" },
  banner: { backgroundColor: "#7c2d12", paddingVertical: 8, paddingHorizontal: 12 },
  bannerText: { color: "#ffedd5", fontWeight: "600", textAlign: "center" }
});
