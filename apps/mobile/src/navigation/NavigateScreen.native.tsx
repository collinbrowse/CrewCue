import { Camera, GeoJSONSource, Layer, Map, OfflineManager } from "@maplibre/maplibre-react-native";
import NetInfo from "@react-native-community/netinfo";
import * as Location from "expo-location";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import type {
  GeocodeSearchResultItem,
  NavigationRouteMeta,
  NavigationRouteResult,
  NavigationRoutingMode
} from "@crewcue/contracts";
import { emitAnalytics } from "../analytics/track";
import { ApiError, createApiClient, type PostRoomRouteInput } from "../api/client";
import { DSButton } from "../design-system";
import { DSTextInput } from "../design-system/DSTextInput";
import { useDSTheme } from "../design-system/theme";
import { corridorBoundsFromRouteAndCheckpoints, estimateTilesForBounds } from "../features/maps/offlineCorridor";
import { basemapStyleAnalyticsId, mobileMapStyleUrlForPreset } from "../features/maps/mapStyleUrl";
import {
  nearestPointOnPolyline,
  navigationActiveStepIndex,
  ROUTE_PROGRESS_DEFAULTS,
  type LonLat
} from "../features/maps/routeProgress";
import type { BasemapPresetId } from "../preferences/basemapPreference";
import { getBasemapPreset, setBasemapPreset } from "../preferences/basemapPreference";
import { getOfflineMapsUnlocked } from "../preferences/offlineMaps";
import { useAuthedShell } from "../shell/AuthedShellContext";

type DestTab = "checkpoints" | "address" | "latlng";

const OFFLINE_MIN_Z = 10;
const OFFLINE_MAX_Z = 14;

export function NavigateScreenNative(): ReactElement {
  const shell = useAuthedShell();
  const theme = useDSTheme();
  const roomId = shell.room?.id;
  const token = shell.auth.status === "authenticated" ? shell.auth.accessToken : undefined;

  const [online, setOnline] = useState(true);
  const [mode, setMode] = useState<NavigationRoutingMode>("drive");
  const [route, setRoute] = useState<NavigationRouteResult | undefined>(undefined);
  const [routeMeta, setRouteMeta] = useState<NavigationRouteMeta | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [stepIndex, setStepIndex] = useState(0);
  const [bannerLogged, setBannerLogged] = useState(false);
  const [entitled, setEntitled] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const [lastPackId, setLastPackId] = useState<string | undefined>(undefined);

  const [destTab, setDestTab] = useState<DestTab>("checkpoints");
  const [routeAllCheckpoints, setRouteAllCheckpoints] = useState(true);
  const [addressQuery, setAddressQuery] = useState("");
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoResults, setGeoResults] = useState<GeocodeSearchResultItem[]>([]);
  const [pickedGeocode, setPickedGeocode] = useState<GeocodeSearchResultItem | undefined>(undefined);
  const [destLatText, setDestLatText] = useState("");
  const [destLngText, setDestLngText] = useState("");

  const [basemapPreset, setBasemapPresetState] = useState<BasemapPresetId>("outdoor");

  const checkpoints =
    shell.room?.mapWorkspace?.checkpoints?.length && shell.room.mapWorkspace.checkpoints.length > 0
      ? shell.room.mapWorkspace.checkpoints
      : shell.room?.course?.checkpoints ?? [];

  useEffect(() => {
    void getOfflineMapsUnlocked().then(setEntitled);
    void getBasemapPreset().then(setBasemapPresetState);
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

    let subscription: Location.LocationSubscription | undefined;

    void (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== Location.PermissionStatus.GRANTED) {
        return;
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 15,
          timeInterval: 4000
        },
        (loc) => {
          const acc = loc.coords.accuracy ?? ROUTE_PROGRESS_DEFAULTS.minAccuracyMeters + 50;
          if (acc > ROUTE_PROGRESS_DEFAULTS.minAccuracyMeters) {
            return;
          }
          const pt: LonLat = { longitude: loc.coords.longitude, latitude: loc.coords.latitude };
          const poly = route.geometry.coordinates as [number, number][];
          const { lateralMeters, alongMeters } = nearestPointOnPolyline(poly, pt);
          const nextIdx = navigationActiveStepIndex(route, alongMeters, lateralMeters);
          if (nextIdx === null) {
            return;
          }
          setStepIndex((prev) => Math.max(prev, nextIdx));
        }
      );
    })();

    return () => {
      subscription?.remove();
    };
  }, [online, route]);

  const resolveStartCoordinate = async (): Promise<LonLat | undefined> => {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status === Location.PermissionStatus.GRANTED) {
      const last = await Location.getLastKnownPositionAsync();
      if (last?.coords) {
        return { longitude: last.coords.longitude, latitude: last.coords.latitude };
      }
      try {
        const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        return { longitude: cur.coords.longitude, latitude: cur.coords.latitude };
      } catch {
        /* fall through */
      }
    }
    const cp = checkpoints[0];
    return cp ? { longitude: cp.longitude, latitude: cp.latitude } : undefined;
  };

  const buildRoutingPayload = async (): Promise<PostRoomRouteInput | null> => {
    if (destTab === "checkpoints") {
      if (checkpoints.length < 2) {
        setError("Add at least two checkpoints in the map workspace.");
        return null;
      }
      const ids = routeAllCheckpoints
        ? checkpoints.map((c) => c.id)
        : [checkpoints[0]!.id, checkpoints[checkpoints.length - 1]!.id];
      return { mode, checkpointIds: ids };
    }

    if (destTab === "address") {
      if (!pickedGeocode) {
        setError("Search for an address and pick a result.");
        return null;
      }
      const start = await resolveStartCoordinate();
      if (!start) {
        setError("Unable to resolve a start position (enable location or add checkpoints).");
        return null;
      }
      return {
        mode,
        coordinates: [
          start,
          { longitude: pickedGeocode.longitude, latitude: pickedGeocode.latitude }
        ]
      };
    }

    const lat = Number(destLatText.trim());
    const lng = Number(destLngText.trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("Enter numeric destination latitude and longitude.");
      return null;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError("Destination coordinates are out of range.");
      return null;
    }
    const start = await resolveStartCoordinate();
    if (!start) {
      setError("Unable to resolve a start position (enable location or add checkpoints).");
      return null;
    }
    return {
      mode,
      coordinates: [start, { longitude: lng, latitude: lat }]
    };
  };

  const fetchRoute = async (options?: { isReroute?: boolean }): Promise<boolean> => {
    if (!roomId || !token) {
      return false;
    }

    const payload = await buildRoutingPayload();
    if (!payload) {
      return false;
    }

    setBusy(true);
    setError(undefined);
    try {
      const client = createApiClient({ baseUrl: shell.baseUrl, accessToken: token });
      const res = await client.postRoomRoute(roomId, payload);
      setRoute(res.route);
      setRouteMeta(res.meta);
      setStepIndex(0);

      let destinationType = "checkpoint_ordered";
      if (destTab === "address") {
        destinationType = "address";
      } else if (destTab === "latlng") {
        destinationType = "lat_lng";
      } else if (!routeAllCheckpoints) {
        destinationType = "checkpoint_ends";
      }

      if (!options?.isReroute) {
        await emitAnalytics({
          baseUrl: shell.baseUrl,
          accessToken: token,
          event: "nav_started",
          properties: {
            mode,
            destination_type: destinationType,
            distance_km: Math.round((res.route.distanceMeters / 1000) * 100) / 100,
            detour_ratio: res.meta?.detourRatio,
            hike_route_quality: res.meta?.hikeRouteQuality
          }
        });
      }
      return true;
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
      return false;
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
    const ok = await fetchRoute({ isReroute: true });
    await emitAnalytics({
      baseUrl: shell.baseUrl,
      accessToken: token,
      event: "nav_reroute",
      properties: { online_only: true, outcome: ok ? "completed" : "provider_error" }
    });
  };

  const runGeocodeSearch = async () => {
    if (!roomId || !token || !online) {
      setError("Geocode requires connectivity.");
      return;
    }
    const q = addressQuery.trim();
    if (q.length < 2) {
      setError("Enter at least 2 characters to search.");
      return;
    }
    setGeoBusy(true);
    setError(undefined);
    try {
      const client = createApiClient({ baseUrl: shell.baseUrl, accessToken: token });
      const res = await client.getGeocodeSearch(roomId, q);
      setGeoResults(res.results);
      setPickedGeocode(undefined);
      if (!res.results.length) {
        setError("No matching addresses.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Geocode failed.");
      setGeoResults([]);
    } finally {
      setGeoBusy(false);
    }
  };

  const downloadCorridorPack = async () => {
    if (!route || !entitled || packBusy || !token) {
      return;
    }
    const bounds = corridorBoundsFromRouteAndCheckpoints(route, checkpoints);
    const est = estimateTilesForBounds(bounds, OFFLINE_MIN_Z, OFFLINE_MAX_Z);
    const areaKm = Math.abs(bounds[2] - bounds[0]) * Math.abs(bounds[3] - bounds[1]) * 111 * 111;
    const styleId = basemapStyleAnalyticsId(basemapPreset);

    await emitAnalytics({
      baseUrl: shell.baseUrl,
      accessToken: token,
      event: "offline_download_requested",
      properties: {
        bbox_area_sq_km: Math.round(areaKm),
        min_zoom: OFFLINE_MIN_Z,
        max_zoom: OFFLINE_MAX_Z,
        style_id: styleId,
        estimated_tile_count: est,
        corridor_width: 0.12,
        checkpoint_count: checkpoints.length
      }
    });

    const started = Date.now();
    await emitAnalytics({
      baseUrl: shell.baseUrl,
      accessToken: token,
      event: "offline_download_started",
      properties: {
        bbox_area_sq_km: Math.round(areaKm),
        min_zoom: OFFLINE_MIN_Z,
        max_zoom: OFFLINE_MAX_Z,
        style_id: styleId
      }
    });

    setPackBusy(true);
    try {
      let packErr: Error | undefined;
      const pack = await OfflineManager.createPack(
        {
          mapStyle: mobileMapStyleUrlForPreset(basemapPreset),
          bounds,
          minZoom: OFFLINE_MIN_Z,
          maxZoom: OFFLINE_MAX_Z,
          metadata: { roomId }
        },
        () => {},
        (_p, err) => {
          packErr = new Error(err.message);
        }
      );
      setLastPackId(pack.id);

      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline && !packErr) {
        const st = await pack.status();
        if (st.state === "complete") {
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }

      if (packErr) {
        throw packErr;
      }
      const finalStatus = await pack.status();
      if (finalStatus.state !== "complete") {
        throw new Error("offline_pack_timeout");
      }

      await emitAnalytics({
        baseUrl: shell.baseUrl,
        accessToken: token,
        event: "offline_download_completed",
        properties: { duration_ms: Date.now() - started, style_id: styleId }
      });
    } catch (err: unknown) {
      await emitAnalytics({
        baseUrl: shell.baseUrl,
        accessToken: token,
        event: "offline_download_failed",
        properties: {
          duration_ms: Date.now() - started,
          error_code: err instanceof Error ? err.message.slice(0, 120) : "pack_error",
          style_id: styleId
        }
      });
    } finally {
      setPackBusy(false);
    }
  };

  const deleteOfflinePack = async () => {
    if (!lastPackId || packBusy) {
      return;
    }
    try {
      await OfflineManager.deletePack(lastPackId);
      await emitAnalytics({
        baseUrl: shell.baseUrl,
        accessToken: token,
        event: "offline_download_deleted",
        properties: { pack_id: lastPackId }
      });
      setLastPackId(undefined);
    } catch {
      /* ignore */
    }
  };

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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.color.background },
        mapWrap: { height: 260 },
        map: { flex: 1 },
        panel: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
        title: { color: theme.color.text, fontWeight: "700", marginTop: 12 },
        subtitle: { color: theme.color.muted, marginBottom: 8 },
        body: { color: theme.color.body, marginTop: 8 },
        row: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" },
        step: { color: theme.color.muted, marginBottom: 4 },
        stepActive: { color: theme.color.warning, fontWeight: "700", marginBottom: 4 },
        error: { color: theme.color.danger, marginTop: 8 },
        centered: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          backgroundColor: theme.color.background
        },
        banner: { backgroundColor: theme.color.warning, paddingVertical: 8, paddingHorizontal: 12 },
        bannerText: { color: theme.color.text, fontWeight: "600", textAlign: "center" },
        geoHit: {
          paddingVertical: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.color.divider
        },
        geoHitLabel: { color: theme.color.text }
      }),
    [theme]
  );

  if (!roomId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body}>Select a race room to use navigation.</Text>
      </View>
    );
  }

  const checkpointsBlocked = destTab === "checkpoints" && checkpoints.length < 2;

  const pickBasemap = async (preset: BasemapPresetId) => {
    setBasemapPresetState(preset);
    await setBasemapPreset(preset);
  };

  return (
    <View style={styles.root}>
      {!online && route ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Offline: rerouting unavailable</Text>
        </View>
      ) : null}

      <View style={styles.mapWrap}>
        <Map style={styles.map} mapStyle={mobileMapStyleUrlForPreset(basemapPreset)}>
          <Camera zoom={route ? 11 : 3} center={center} duration={200} />
          {routeFeature ? (
            <GeoJSONSource id="nav-route" data={routeFeature}>
              <Layer
                id="nav-route-line"
                type="line"
                style={{ lineColor: "#a855f7", lineWidth: 5, lineOpacity: 0.9 }}
              />
            </GeoJSONSource>
          ) : null}
        </Map>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ paddingBottom: 32 }}>
        <Text style={styles.title}>Basemap</Text>
        <View style={styles.row}>
          {(["outdoor", "streets", "satellite"] as const).map((p) => (
            <DSButton key={p} preset={basemapPreset === p ? "primary" : "secondary"} onPress={() => void pickBasemap(p)}>
              {p}
            </DSButton>
          ))}
        </View>

        <Text style={styles.title}>Destination</Text>
        <View style={styles.row}>
          <DSButton preset={destTab === "checkpoints" ? "primary" : "secondary"} onPress={() => setDestTab("checkpoints")}>
            Checkpoints
          </DSButton>
          <DSButton preset={destTab === "address" ? "primary" : "secondary"} onPress={() => setDestTab("address")} disabled={!online}>
            Address
          </DSButton>
          <DSButton preset={destTab === "latlng" ? "primary" : "secondary"} onPress={() => setDestTab("latlng")}>
            Lat / lng
          </DSButton>
        </View>

        {destTab === "checkpoints" ? (
          <>
            {checkpointsBlocked ? (
              <Text style={styles.body}>Add at least two checkpoints in the map workspace for this mode.</Text>
            ) : (
              <View style={styles.row}>
                <Text style={styles.body}>Route via all checkpoints</Text>
                <Switch value={routeAllCheckpoints} onValueChange={setRouteAllCheckpoints} />
              </View>
            )}
          </>
        ) : null}

        {destTab === "address" ? (
          <>
            <DSTextInput
              placeholder="Search address"
              value={addressQuery}
              onChangeText={setAddressQuery}
              editable={online}
              autoCorrect={false}
            />
            <View style={styles.row}>
              <DSButton preset="secondary" onPress={() => void runGeocodeSearch()} disabled={!online || geoBusy}>
                {geoBusy ? "Searching…" : "Search"}
              </DSButton>
            </View>
            {geoResults.map((g, idx) => (
              <TouchableOpacity
                key={`${g.label}-${idx}`}
                style={styles.geoHit}
                onPress={() => setPickedGeocode(g)}
              >
                <Text style={[styles.geoHitLabel, pickedGeocode?.label === g.label ? { fontWeight: "700" } : undefined]}>
                  {g.label}
                </Text>
              </TouchableOpacity>
            ))}
          </>
        ) : null}

        {destTab === "latlng" ? (
          <>
            <DSTextInput placeholder="Destination latitude" value={destLatText} onChangeText={setDestLatText} keyboardType="decimal-pad" />
            <DSTextInput placeholder="Destination longitude" value={destLngText} onChangeText={setDestLngText} keyboardType="decimal-pad" />
          </>
        ) : null}

        <Text style={styles.title}>Mode</Text>
        <View style={styles.row}>
          <DSButton preset={mode === "drive" ? "primary" : "secondary"} onPress={() => setMode("drive")}>
            Drive
          </DSButton>
          <DSButton preset={mode === "hike" ? "primary" : "secondary"} onPress={() => setMode("hike")}>
            Hike
          </DSButton>
        </View>

        {routeMeta?.hikeRouteQuality === "possibly_indirect" && mode === "hike" ? (
          <Text style={styles.body}>
            Walking directions follow roads/paths and may detour significantly here — verify on map before committing.
          </Text>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.row}>
          <DSButton preset="primary" onPress={() => void fetchRoute()} disabled={busy || checkpointsBlocked}>
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
            <View style={styles.row}>
              <DSButton preset="secondary" onPress={() => void downloadCorridorPack()} disabled={!entitled || packBusy}>
                {packBusy ? "Downloading…" : "Download offline corridor"}
              </DSButton>
              {lastPackId ? (
                <DSButton preset="secondary" onPress={() => void deleteOfflinePack()} disabled={packBusy}>
                  Remove offline pack
                </DSButton>
              ) : null}
            </View>
          </>
        ) : (
          <Text style={styles.body}>Configure a destination above, then compute a route.</Text>
        )}

        {busy ? <ActivityIndicator /> : null}
      </ScrollView>
    </View>
  );
}

// Keep parity with the non-native module export so `import "./NavigateScreen"`
// works on native platform resolution.
export const NavigateScreen = NavigateScreenNative;
