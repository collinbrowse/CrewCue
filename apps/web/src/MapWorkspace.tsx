import type { MapWorkspaceLayer, RaceCourseCheckpoint, RaceMapWorkspace } from "@crewcue/contracts";
import { parseUploadToWorkspaceLayer } from "@crewcue/map-core";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement
} from "react";
import { createWebApiClient } from "./api/client";
import { webMapStyleUrl } from "./mapStyleUrl";

const SOURCE_PREFIX = "workspace-layer-";

export function MapWorkspace(): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [workspace, setWorkspace] = useState<RaceMapWorkspace>({
    layers: [],
    checkpoints: []
  });
  const [status, setStatus] = useState<string>("");

  const apiConfigured = Boolean(
    import.meta.env.VITE_API_BASE_URL?.trim() &&
      import.meta.env.VITE_CREWCUE_ACCESS_TOKEN?.trim() &&
      import.meta.env.VITE_CREWCUE_ROOM_ID?.trim()
  );

  const redrawLayers = useCallback((next: RaceMapWorkspace) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    for (const layer of map.getStyle().layers ?? []) {
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: webMapStyleUrl(),
      center: [-98.5795, 39.8283],
      zoom: 3
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
    mapRef.current = map;
    map.on("load", () => {
      setMapReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapReady) {
      return;
    }
    redrawLayers(workspace);
  }, [mapReady, workspace, redrawLayers]);

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const layer = parseUploadToWorkspaceLayer(text, file.name);
      const next: RaceMapWorkspace = {
        ...workspace,
        layers: [...workspace.layers, layer],
        selectedLayerId: layer.id
      };
      setWorkspace(next);
      setStatus(`Added layer ${layer.label}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not parse file.";
      setStatus(message);
    }
  };

  const toggleLayer = (layerId: string, visible: boolean) => {
    setWorkspace({
      ...workspace,
      layers: workspace.layers.map((layer) => (layer.id === layerId ? { ...layer, visible } : layer))
    });
  };

  const selectLayer = (layerId: string) => {
    setWorkspace({ ...workspace, selectedLayerId: layerId });
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
        <strong>CrewCue map workspace</strong>
        <div style={{ fontSize: 13, color: "#475569" }}>{layerHint}</div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 14 }}>
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
        {status ? <div style={{ marginTop: 8, fontSize: 13 }}>{status}</div> : null}
      </header>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside style={{ width: 280, borderRight: "1px solid #e2e8f0", overflowY: "auto", padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Layers</div>
          {workspace.layers.map((layer: MapWorkspaceLayer) => (
            <div key={layer.id} style={{ marginBottom: 10, padding: 8, border: "1px solid #e2e8f0", borderRadius: 8 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={(event) => toggleLayer(layer.id, event.target.checked)}
                />
                <span style={{ fontWeight: workspace.selectedLayerId === layer.id ? 700 : 400 }}>{layer.label}</span>
              </label>
              <button type="button" style={{ marginTop: 6 }} onClick={() => selectLayer(layer.id)}>
                Select
              </button>
            </div>
          ))}
          <div style={{ fontWeight: 600, margin: "16px 0 8px" }}>Checkpoints ({workspace.checkpoints.length})</div>
          <p style={{ fontSize: 13, color: "#64748b" }}>
            Checkpoint placement matches mobile on native apps (tap-to-place while placement mode is enabled).
          </p>
        </aside>
        <div ref={containerRef} style={{ flex: 1, minHeight: 320 }} />
      </div>
    </div>
  );
}
