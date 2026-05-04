import { randomUUID } from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Alert,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type AlertButton
} from "react-native";
import { Camera, GeoJSONSource, Layer, Map } from "@maplibre/maplibre-react-native";
import type { RaceCourseCheckpoint, RaceMapWorkspace } from "@crewcue/contracts";
import { parseUploadToWorkspaceLayerWithAnalytics } from "@crewcue/map-core";
import * as FileSystem from "expo-file-system/legacy";
import { emitAnalytics } from "../analytics/track";
import { createApiClient } from "../api/client";
import { DSButton } from "../design-system";
import { useDSTheme } from "../design-system/theme";
import { mobileMapStyleUrlForPreset } from "../features/maps/mapStyleUrl";
import type { BasemapPresetId } from "../preferences/basemapPreference";
import { getBasemapPreset, setBasemapPreset } from "../preferences/basemapPreference";
import { useAuthedShell } from "../shell/AuthedShellContext";

function layerFeature(layerId: string, geometry: RaceMapWorkspace["layers"][number]["geometry"]) {
  return {
    type: "Feature",
    id: layerId,
    properties: {},
    geometry
  } as const;
}

function checkpointsFeatureCollection(checkpoints: RaceCourseCheckpoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: checkpoints.map((cp, index) => ({
      type: "Feature" as const,
      id: `${cp.id}-${index}`,
      properties: { title: cp.id },
      geometry: {
        type: "Point" as const,
        coordinates: [cp.longitude, cp.latitude] as [number, number]
      }
    }))
  };
}

type UploadAnalyticsPayload = {
  vertex_count: number;
  vertex_bucket: string;
  waypoint_count: number;
  track_segments: number;
};

type PersistAnalytics = {
  layerToggle?: { layerId: string; visible: boolean };
  uploadStats?: UploadAnalyticsPayload;
  selectedLayerId?: string;
};

export function MapWorkspaceScreenNative(): ReactElement {
  const shell = useAuthedShell();
  const theme = useDSTheme();
  const roomId = shell.room?.id;
  const token = shell.auth.status === "authenticated" ? shell.auth.accessToken : undefined;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [workspace, setWorkspace] = useState<RaceMapWorkspace>({
    layers: [],
    checkpoints: []
  });
  const [placementMode, setPlacementMode] = useState(false);
  const [basemapPreset, setBasemapPresetState] = useState<BasemapPresetId>("outdoor");

  const reload = useCallback(async () => {
    if (!roomId || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const client = createApiClient({ baseUrl: shell.baseUrl, accessToken: token });
      const res = await client.getMapWorkspace(roomId);
      setWorkspace(res.mapWorkspace);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to load map workspace.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [roomId, shell.baseUrl, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void getBasemapPreset().then(setBasemapPresetState);
  }, []);

  const persist = async (next: RaceMapWorkspace, analytics?: PersistAnalytics): Promise<boolean> => {
    if (!roomId || !token) {
      return false;
    }
    setSaving(true);
    setError(undefined);
    try {
      const client = createApiClient({ baseUrl: shell.baseUrl, accessToken: token });
      const updatedRoom = await client.putMapWorkspace(roomId, {
        layers: next.layers,
        selectedLayerId: next.selectedLayerId,
        drivesProjectionLayerId: next.drivesProjectionLayerId,
        checkpoints: next.checkpoints,
        syncBaselineFromLayer: false
      });
      if (updatedRoom.mapWorkspace) {
        setWorkspace(updatedRoom.mapWorkspace);
      } else {
        setWorkspace(next);
      }
      shell.onApplyRaceRoomFromServer(updatedRoom);

      if (analytics?.layerToggle) {
        await emitAnalytics({
          baseUrl: shell.baseUrl,
          accessToken: token,
          event: "layer_toggled",
          properties: { visible: analytics.layerToggle.visible, layer_id: analytics.layerToggle.layerId }
        });
      }
      if (analytics?.uploadStats) {
        const ua = analytics.uploadStats;
        await emitAnalytics({
          baseUrl: shell.baseUrl,
          accessToken: token,
          event: "gpx_uploaded",
          properties: {
            file_count: 1,
            layers_total: next.layers.length,
            vertex_count: ua.vertex_count,
            vertex_bucket: ua.vertex_bucket,
            waypoint_count: ua.waypoint_count,
            track_segments: ua.track_segments
          }
        });
      }
      if (analytics?.selectedLayerId !== undefined) {
        await emitAnalytics({
          baseUrl: shell.baseUrl,
          accessToken: token,
          event: "layer_selected",
          properties: { layer_id: analytics.selectedLayerId }
        });
      }
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to save map workspace.";
      setError(message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onPickUpload = async () => {
    if (!roomId || !token) {
      return;
    }
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true
      });
      if (pick.canceled || !pick.assets?.[0]) {
        return;
      }
      const asset = pick.assets[0];
      const uri = asset.uri;
      const name = asset.name ?? "upload";
      const contents = await FileSystem.readAsStringAsync(uri);
      const { layer, uploadAnalytics } = parseUploadToWorkspaceLayerWithAnalytics(contents, name);
      const next: RaceMapWorkspace = {
        ...workspace,
        layers: [...workspace.layers, layer],
        selectedLayerId: layer.id
      };
      await persist(next, { uploadStats: uploadAnalytics, selectedLayerId: layer.id });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unsupported route file.";
      setError(message);
    }
  };

  const toggleLayer = async (layerId: string, visible: boolean) => {
    const next: RaceMapWorkspace = {
      ...workspace,
      layers: workspace.layers.map((l) => (l.id === layerId ? { ...l, visible } : l))
    };
    await persist(next, { layerToggle: { layerId, visible } });
  };

  const selectLayer = async (layerId: string) => {
    const next: RaceMapWorkspace = {
      ...workspace,
      selectedLayerId: layerId
    };
    setWorkspace(next);
    await persist(next, { selectedLayerId: layerId });
  };

  const mapPress = async (event: NativeSyntheticEvent<{ lngLat: [number, number] }>) => {
    if (!placementMode || !roomId || !token) {
      return;
    }
    const lngLat = event.nativeEvent.lngLat;
    const longitude = lngLat[0];
    const latitude = lngLat[1];
    const cp: RaceCourseCheckpoint = {
      id: `cp-${randomUUID().slice(0, 8)}`,
      latitude,
      longitude,
      plannedStopSeconds: 120
    };
    const next: RaceMapWorkspace = {
      ...workspace,
      checkpoints: [...workspace.checkpoints, cp]
    };
    const ok = await persist(next);
    if (ok) {
      await emitAnalytics({
        baseUrl: shell.baseUrl,
        accessToken: token,
        event: "checkpoint_added",
        properties: { checkpoint_id: cp.id }
      });
    }
  };

  const confirmRemoveCheckpoint = (checkpointId: string) => {
    const buttons: AlertButton[] = [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          void (async () => {
            const ok = await persist({
              ...workspace,
              checkpoints: workspace.checkpoints.filter((c) => c.id !== checkpointId)
            });
            if (ok) {
              await emitAnalytics({
                baseUrl: shell.baseUrl,
                accessToken: token,
                event: "checkpoint_removed",
                properties: { checkpoint_id: checkpointId }
              });
            }
          })();
        }
      }
    ];
    Alert.alert("Remove checkpoint?", undefined, buttons);
  };

  const checkpointGeoJson = useMemo(() => checkpointsFeatureCollection(workspace.checkpoints), [workspace.checkpoints]);

  const center = useMemo(() => {
    const visible = workspace.layers.find((l) => l.visible && l.geometry.coordinates.length > 0);
    if (!visible || visible.geometry.type !== "LineString") {
      return { lngLat: [-98.5795, 39.8283] as [number, number], zoom: 3 };
    }
    const [lng, lat] = visible.geometry.coordinates[Math.floor(visible.geometry.coordinates.length / 2)]!;
    return { lngLat: [lng, lat] as [number, number], zoom: 12 };
  }, [workspace.layers]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.color.background },
        mapWrap: { height: 280 },
        map: { flex: 1 },
        panel: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
        title: { color: theme.color.text, fontWeight: "700", marginTop: 12, marginBottom: 8 },
        body: { color: theme.color.body, marginTop: 8 },
        hint: { color: theme.color.muted, fontSize: 13, marginBottom: 8 },
        error: { color: theme.color.danger, marginBottom: 8 },
        centered: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          backgroundColor: theme.color.background
        },
        layerRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          flexWrap: "wrap"
        },
        layerLabel: { flex: 1, color: theme.color.text, minWidth: 120 },
        layerSelected: { color: theme.color.warning, fontWeight: "700" },
        rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
        checkpointRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          gap: 8
        },
        mono: { color: theme.color.body, fontFamily: "Menlo", flex: 1 },
        row: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }
      }),
    [theme]
  );

  const pickBasemap = async (preset: BasemapPresetId) => {
    setBasemapPresetState(preset);
    await setBasemapPreset(preset);
  };

  if (!roomId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body}>Select a race room to open the map workspace.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.body}>Loading workspace…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.mapWrap}>
        <Map style={styles.map} mapStyle={mobileMapStyleUrlForPreset(basemapPreset)} onPress={mapPress}>
          <Camera center={center.lngLat} zoom={center.zoom} duration={0} />
          {workspace.layers
            .filter((layer) => layer.visible)
            .map((layer) => (
              <GeoJSONSource
                key={layer.id}
                id={`layer-src-${layer.id}`}
                data={layerFeature(layer.id, layer.geometry)}
              >
                <Layer
                  id={`layer-line-${layer.id}`}
                  type="line"
                  style={{
                    lineColor: layer.strokeColor ?? (workspace.selectedLayerId === layer.id ? "#f97316" : "#2563eb"),
                    lineWidth: workspace.selectedLayerId === layer.id ? 6 : 3,
                    lineOpacity: 0.9
                  }}
                />
              </GeoJSONSource>
            ))}
          <GeoJSONSource id="checkpoint-points" data={checkpointGeoJson}>
            <Layer
              id="checkpoint-circles"
              type="circle"
              style={{
                circleRadius: 6,
                circleColor: "#22c55e",
                circleStrokeWidth: 2,
                circleStrokeColor: "#ffffff"
              }}
            />
          </GeoJSONSource>
        </Map>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ paddingBottom: 24 }}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.title}>Basemap</Text>
        <View style={styles.row}>
          {(["outdoor", "streets", "satellite", "demo"] as const).map((p) => (
            <DSButton key={p} preset={basemapPreset === p ? "primary" : "secondary"} onPress={() => void pickBasemap(p)}>
              {p}
            </DSButton>
          ))}
        </View>

        <Text style={styles.title}>Layers</Text>
        <DSButton preset="secondary" onPress={onPickUpload} disabled={saving}>
          Upload GPX / KML layer
        </DSButton>
        {workspace.layers.map((layer) => (
          <View key={layer.id} style={styles.layerRow}>
            <Switch value={layer.visible} onValueChange={(v) => void toggleLayer(layer.id, v)} />
            <Text style={[styles.layerLabel, workspace.selectedLayerId === layer.id ? styles.layerSelected : undefined]}>
              {layer.label}
            </Text>
            <DSButton preset="secondary" onPress={() => void selectLayer(layer.id)} disabled={saving}>
              Select
            </DSButton>
          </View>
        ))}

        <View style={styles.rowBetween}>
          <Text style={styles.title}>Place checkpoints</Text>
          <Switch value={placementMode} onValueChange={setPlacementMode} />
        </View>
        <Text style={styles.hint}>{placementMode ? "Tap the map to drop a checkpoint." : "Enable, then tap the map."}</Text>

        <Text style={styles.title}>Checkpoints ({workspace.checkpoints.length})</Text>
        {workspace.checkpoints.map((cp) => (
          <View key={cp.id} style={styles.checkpointRow}>
            <Text style={styles.mono}>{cp.id}</Text>
            <DSButton preset="secondary" onPress={() => confirmRemoveCheckpoint(cp.id)}>
              Remove
            </DSButton>
          </View>
        ))}

        <DSButton preset="primary" onPress={() => void reload()} disabled={saving}>
          {saving ? "Saving…" : "Reload from server"}
        </DSButton>
      </ScrollView>
    </View>
  );
}
