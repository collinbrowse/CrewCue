import type { MapWorkspaceLayer, RaceCourseCheckpoint, RaceMapWorkspace } from "@crewcue/contracts";
import {
  PRIMARY_COURSE_ROUTE_LAYER_ID,
  buildRaceCourseFromGpx,
  computeElevationGainMeters,
  parseCourseTrack,
  parseUploadToWorkspaceLayerWithAnalytics,
  parsedTrackToWorkspaceLayer,
  summarizeParsedCourseUploadAnalytics
} from "@crewcue/map-core";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactElement
} from "react";
import { emitWebAnalytics } from "./analytics/track";
import { createWebApiClient } from "./api/client";
import type { WebBasemapPresetId } from "./mapStyleUrl";
import { webBasemapAnalyticsId, webMapStyleUrlForPreset } from "./mapStyleUrl";

const SOURCE_PREFIX = "workspace-layer-";
const BASEMAP_LS_KEY = "crewcue.web_basemap_preset";

function readStoredBasemap(): WebBasemapPresetId {
  if (typeof window === "undefined") {
    return "outdoor";
  }
  try {
    const raw = window.localStorage.getItem(BASEMAP_LS_KEY);
    if (raw === "outdoor" || raw === "streets" || raw === "satellite" || raw === "demo") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return "outdoor";
}

export function MapWorkspace(): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const workspaceRef = useRef<RaceMapWorkspace>({
    layers: [],
    checkpoints: []
  });
  const placementModeRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [workspace, setWorkspace] = useState<RaceMapWorkspace>({
    layers: [],
    checkpoints: []
  });
  const [placementMode, setPlacementMode] = useState(false);
  const [basemapPreset, setBasemapPreset] = useState<WebBasemapPresetId>(readStoredBasemap);
  const [status, setStatus] = useState<string>("");

  workspaceRef.current = workspace;
  placementModeRef.current = placementMode;

  const apiConfigured = Boolean(
    import.meta.env.VITE_API_BASE_URL?.trim() &&
      import.meta.env.VITE_CREWCUE_ACCESS_TOKEN?.trim() &&
      import.meta.env.VITE_CREWCUE_ROOM_ID?.trim()
  );

  const analyticsAuth = useMemo(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";
    const token = import.meta.env.VITE_CREWCUE_ACCESS_TOKEN?.trim();
    return { baseUrl, token };
  }, []);

  const redrawLayers = useCallback((next: RaceMapWorkspace) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    for (const layer of [...(map.getStyle().layers ?? [])]) {
      if (layer.id.startsWith(SOURCE_PREFIX) || layer.id === "workspace-checkpoints-circle") {
        map.removeLayer(layer.id);
      }
    }
    for (const sourceId of Object.keys(map.getStyle().sources ?? {})) {
      if (sourceId.startsWith(SOURCE_PREFIX) || sourceId === "workspace-checkpoints") {
        map.removeSource(sourceId);
      }
    }

    for (const layer of next.layers.filter((entry: MapWorkspaceLayer) => entry.visible)) {
      const sourceId = `${SOURCE_PREFIX}${layer.id}`;
      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: layer.geometry
        }
      });
      map.addLayer({
        id: `${sourceId}-line`,
        type: "line",
        source: sourceId,
        layout: {
          "line-cap": "round",
          "line-join": "round"
        },
        paint: {
          "line-color": layer.strokeColor ?? (next.selectedLayerId === layer.id ? "#f97316" : "#2563eb"),
          "line-width": next.selectedLayerId === layer.id ? 6 : 3,
          "line-opacity": 0.9
        }
      });
    }

    const checkpointFc = {
      type: "FeatureCollection" as const,
      features: next.checkpoints.map((cp: RaceCourseCheckpoint) => ({
        type: "Feature" as const,
        properties: { title: cp.id },
        geometry: {
          type: "Point" as const,
          coordinates: [cp.longitude, cp.latitude] as [number, number]
        }
      }))
    };

    map.addSource("workspace-checkpoints", {
      type: "geojson",
      data: checkpointFc
    });
    map.addLayer({
      id: "workspace-checkpoints-circle",
      type: "circle",
      source: "workspace-checkpoints",
      paint: {
        "circle-radius": 6,
        "circle-color": "#22c55e",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff"
      }
    });
  }, []);

  const skipBasemapStyleReload = useRef(true);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: webMapStyleUrlForPreset(readStoredBasemap()),
      center: [-98.5795, 39.8283],
      zoom: 3
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
    mapRef.current = map;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!placementModeRef.current) {
        return;
      }
      const lng = e.lngLat.lng;
      const lat = e.lngLat.lat;
      const id = `cp-${crypto.randomUUID().slice(0, 8)}`;
      const cp: RaceCourseCheckpoint = {
        id,
        latitude: lat,
        longitude: lng,
        plannedStopSeconds: 120
      };
      setWorkspace((prev) => ({
        ...prev,
        checkpoints: [...prev.checkpoints, cp]
      }));
      void emitWebAnalytics({
        baseUrl: analyticsAuth.baseUrl,
        accessToken: analyticsAuth.token,
        event: "checkpoint_added",
        properties: { checkpoint_id: id }
      });
    };

    map.on("click", onClick);
    map.on("load", () => {
      setMapReady(true);
    });

    return () => {
      map.off("click", onClick);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [analyticsAuth.baseUrl, analyticsAuth.token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    redrawLayers(workspace);
  }, [mapReady, workspace, redrawLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    if (skipBasemapStyleReload.current) {
      skipBasemapStyleReload.current = false;
      return;
    }
    map.setStyle(webMapStyleUrlForPreset(basemapPreset));
    map.once("styledata", () => {
      redrawLayers(workspaceRef.current);
    });
  }, [basemapPreset, mapReady, redrawLayers]);

  const persistBasemap = (preset: WebBasemapPresetId) => {
    setBasemapPreset(preset);
    try {
      window.localStorage.setItem(BASEMAP_LS_KEY, preset);
    } catch {
      /* ignore */
    }
  };

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
      const token = import.meta.env.VITE_CREWCUE_ACCESS_TOKEN?.trim();
      const roomId = import.meta.env.VITE_CREWCUE_ROOM_ID?.trim();

      if (baseUrl && token && roomId) {
        const parsed = parseCourseTrack(text, file.name);
        const { course, plannedPaceSecondsPerKm } = buildRaceCourseFromGpx(parsed);
        const routeOverlayLayer = parsedTrackToWorkspaceLayer(file.name, parsed);
        const uploadAnalytics = summarizeParsedCourseUploadAnalytics(parsed);
        const client = createWebApiClient({ baseUrl, accessToken: token });
        const updatedRoom = await client.updateRaceCourse(roomId, {
          course,
          plannedPaceSecondsPerKm,
          courseDistanceMeters: parsed.totalDistanceMeters,
          courseElevationGainMeters: computeElevationGainMeters(parsed.points),
          courseFileName: file.name,
          routeOverlayLayer
        });
        const next = updatedRoom.mapWorkspace ?? { layers: [], checkpoints: [] };
        setWorkspace(next);
        workspaceRef.current = next;
        setStatus(`Synced course + map from ${file.name}`);
        await emitWebAnalytics({
          baseUrl: analyticsAuth.baseUrl,
          accessToken: analyticsAuth.token,
          event: "gpx_uploaded",
          properties: {
            file_count: 1,
            layers_total: next.layers.length,
            vertex_count: uploadAnalytics.vertex_count,
            vertex_bucket: uploadAnalytics.vertex_bucket,
            waypoint_count: uploadAnalytics.waypoint_count,
            track_segments: uploadAnalytics.track_segments,
            style_id: webBasemapAnalyticsId(basemapPreset)
          }
        });
        await emitWebAnalytics({
          baseUrl: analyticsAuth.baseUrl,
          accessToken: analyticsAuth.token,
          event: "layer_selected",
          properties: { layer_id: PRIMARY_COURSE_ROUTE_LAYER_ID }
        });
      } else {
        const { layer, uploadAnalytics } = parseUploadToWorkspaceLayerWithAnalytics(text, file.name);
        const next: RaceMapWorkspace = {
          ...workspace,
          layers: [...workspace.layers, layer],
          selectedLayerId: layer.id
        };
        setWorkspace(next);
        setStatus(`Added layer ${layer.label}`);
        await emitWebAnalytics({
          baseUrl: analyticsAuth.baseUrl,
          accessToken: analyticsAuth.token,
          event: "gpx_uploaded",
          properties: {
            file_count: 1,
            layers_total: next.layers.length,
            vertex_count: uploadAnalytics.vertex_count,
            vertex_bucket: uploadAnalytics.vertex_bucket,
            waypoint_count: uploadAnalytics.waypoint_count,
            track_segments: uploadAnalytics.track_segments,
            style_id: webBasemapAnalyticsId(basemapPreset)
          }
        });
        await emitWebAnalytics({
          baseUrl: analyticsAuth.baseUrl,
          accessToken: analyticsAuth.token,
          event: "layer_selected",
          properties: { layer_id: layer.id }
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not parse file.";
      setStatus(message);
    }
  };

  const toggleLayer = async (layerId: string, visible: boolean) => {
    setWorkspace((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) => (layer.id === layerId ? { ...layer, visible } : layer))
    }));
    await emitWebAnalytics({
      baseUrl: analyticsAuth.baseUrl,
      accessToken: analyticsAuth.token,
      event: "layer_toggled",
      properties: { visible, layer_id: layerId }
    });
  };

  const selectLayer = async (layerId: string) => {
    setWorkspace((prev) => ({ ...prev, selectedLayerId: layerId }));
    await emitWebAnalytics({
      baseUrl: analyticsAuth.baseUrl,
      accessToken: analyticsAuth.token,
      event: "layer_selected",
      properties: { layer_id: layerId }
    });
  };

  const removeCheckpoint = async (checkpointId: string) => {
    setWorkspace((prev) => ({
      ...prev,
      checkpoints: prev.checkpoints.filter((c) => c.id !== checkpointId)
    }));
    await emitWebAnalytics({
      baseUrl: analyticsAuth.baseUrl,
      accessToken: analyticsAuth.token,
      event: "checkpoint_removed",
      properties: { checkpoint_id: checkpointId }
    });
  };

  const persistRemote = async () => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
    const token = import.meta.env.VITE_CREWCUE_ACCESS_TOKEN?.trim();
    const roomId = import.meta.env.VITE_CREWCUE_ROOM_ID?.trim();
    if (!baseUrl || !token || !roomId) {
      setStatus("Set VITE_API_BASE_URL, VITE_CREWCUE_ACCESS_TOKEN, and VITE_CREWCUE_ROOM_ID to sync.");
      return;
    }
    try {
      const client = createWebApiClient({ baseUrl, accessToken: token });
      await client.putMapWorkspace(roomId, {
        layers: workspace.layers,
        selectedLayerId: workspace.selectedLayerId,
        drivesProjectionLayerId: workspace.drivesProjectionLayerId,
        checkpoints: workspace.checkpoints,
        syncBaselineFromLayer: false
      });
      setStatus("Saved map workspace to CrewCue API.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed.";
      setStatus(message);
    }
  };

  const loadRemote = async () => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
    const token = import.meta.env.VITE_CREWCUE_ACCESS_TOKEN?.trim();
    const roomId = import.meta.env.VITE_CREWCUE_ROOM_ID?.trim();
    if (!baseUrl || !token || !roomId) {
      setStatus("Configure API env vars to load remote workspace.");
      return;
    }
    try {
      const client = createWebApiClient({ baseUrl, accessToken: token });
      const res = await client.getMapWorkspace(roomId);
      setWorkspace(res.mapWorkspace);
      setStatus("Loaded workspace from API.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Load failed.";
      setStatus(message);
    }
  };

  const layerHint = useMemo(() => {
    return apiConfigured ? "API sync enabled via env vars." : "Local-only layers until API env vars are set.";
  }, [apiConfigured]);

  const shellStyle: CSSProperties = useMemo(
    () => ({
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      fontFamily: "var(--sans)",
      background: "var(--bg)",
      color: "var(--text)",
      textAlign: "left"
    }),
    []
  );

  return (
    <div style={shellStyle}>
      <header
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--social-bg)"
        }}
      >
        <strong style={{ color: "var(--text-h)" }}>CrewCue map workspace</strong>
        <div style={{ fontSize: 13, color: "var(--text)" }}>{layerHint}</div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 14, color: "var(--text-h)" }}>
            Basemap{" "}
            <select
              value={basemapPreset}
              onChange={(e) => persistBasemap(e.target.value as WebBasemapPresetId)}
              style={{ marginLeft: 8 }}
            >
              <option value="outdoor">outdoor</option>
              <option value="streets">streets</option>
              <option value="satellite">satellite</option>
              <option value="demo">demo</option>
            </select>
          </label>
          <label style={{ fontSize: 14, color: "var(--text-h)" }}>
            <input type="file" accept=".gpx,.kml,.json,.geojson" onChange={(e) => void onUpload(e)} /> Upload GPX/KML
          </label>
          {apiConfigured ? (
            <>
              <button type="button" onClick={() => void loadRemote()}>
                Load from API
              </button>
              <button type="button" onClick={() => void persistRemote()}>
                Save to API
              </button>
            </>
          ) : null}
        </div>
        {status ? (
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-h)" }}>
            {status}
          </div>
        ) : null}
      </header>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside
          style={{
            width: 300,
            borderRight: "1px solid var(--border)",
            overflowY: "auto",
            padding: 12,
            background: "var(--bg)"
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--text-h)" }}>Layers</div>
          {workspace.layers.map((layer: MapWorkspaceLayer) => (
            <div
              key={layer.id}
              style={{
                marginBottom: 10,
                padding: 8,
                border: "1px solid var(--border)",
                borderRadius: 8
              }}
            >
              <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-h)" }}>
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={(event) => void toggleLayer(layer.id, event.target.checked)}
                />
                <span style={{ fontWeight: workspace.selectedLayerId === layer.id ? 700 : 400 }}>{layer.label}</span>
              </label>
              <button type="button" style={{ marginTop: 6 }} onClick={() => void selectLayer(layer.id)}>
                Select
              </button>
            </div>
          ))}
          <div style={{ fontWeight: 600, margin: "16px 0 8px", color: "var(--text-h)" }}>
            Checkpoints ({workspace.checkpoints.length})
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, color: "var(--text-h)" }}>
            <input type="checkbox" checked={placementMode} onChange={(e) => setPlacementMode(e.target.checked)} />
            Placement mode (click map)
          </label>
          {workspace.checkpoints.map((cp) => (
            <div
              key={cp.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
                gap: 8,
                fontSize: 13
              }}
            >
              <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{cp.id}</code>
              <button type="button" onClick={() => void removeCheckpoint(cp.id)}>
                Remove
              </button>
            </div>
          ))}
        </aside>
        <div ref={containerRef} style={{ flex: 1, minHeight: 320 }} />
      </div>
    </div>
  );
}
