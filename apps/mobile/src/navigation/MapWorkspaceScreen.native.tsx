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
import { parseUploadToWorkspaceLayer } from "@crewcue/map-core";
import * as FileSystem from "expo-file-system/legacy";
import { emitAnalytics } from "../analytics/track";
import { createApiClient } from "../api/client";
import { DSButton } from "../design-system";
import { mobileMapStyleUrl } from "../features/maps/mapStyleUrl";
import { useAuthedShell } from "../shell/AuthedShellContext";

function layerFeature(layerId: string, geometry: RaceMapWorkspace["layers"][number]["geometry"]) {
  return {
    type: "Feature",
    id: layerId,
    properties: {},
    geometry
  } as const;
}

function checkpointsFeatureCollection(checkpoints: RaceCourseCheckpoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: checkpoints.map((cp, index) => ({
      type: "Feature",
      id: `${cp.id}-${index}`,
      properties: { title: cp.id },
      geometry: {
        type: "Point",
        coordinates: [cp.longitude, cp.latitude]
      }
    }))
  };
}

export function MapWorkspaceScreenNative(): ReactElement {
  const shell = useAuthedShell();
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

  const persist = async (next: RaceMapWorkspace, analytics?: { toggle?: boolean; upload?: boolean; select?: boolean }) => {
    if (!roomId || !token) {
      return;
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
      if (analytics?.toggle) {
        await emitAnalytics({
          baseUrl: shell.baseUrl,
          accessToken: token,
          event: "layer_toggled",
          properties: { visible_count: next.layers.filter((l) => l.visible).length }
        });
      }
      if (analytics?.upload) {
        await emitAnalytics({
          baseUrl: shell.baseUrl,
          accessToken: token,
          event: "gpx_uploaded",
          properties: {
            file_count: 1,
            layers_total: next.layers.length
          }
        });
      }
      if (analytics?.select) {
        await emitAnalytics({
          baseUrl: shell.baseUrl,
          accessToken: token,
          event: "layer_selected",
          properties: { layer_id: next.selectedLayerId ?? "" }
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to save map workspace.";
      setError(message);
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
      const layer = parseUploadToWorkspaceLayer(contents, name);
      const next: RaceMapWorkspace = {
        ...workspace,
        layers: [...workspace.layers, layer],
        selectedLayerId: layer.id
      };
      await persist(next, { upload: true, select: true });
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
    await persist(next, { toggle: true });
  };

  const selectLayer = async (layerId: string) => {
    const next: RaceMapWorkspace = {
      ...workspace,
      selectedLayerId: layerId
    };
    setWorkspace(next);
    await persist(next, { select: true });
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
    await persist(next);
  };

  const confirmRemoveCheckpoint = (checkpointId: string) => {
    const buttons: AlertButton[] = [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          void persist({
            ...workspace,
            checkpoints: workspace.checkpoints.filter((c) => c.id !== checkpointId)
          });
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
        <Map style={styles.map} mapStyle={mobileMapStyleUrl()} onPress={mapPress}>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  mapWrap: { height: 280 },
  map: { flex: 1 },
  panel: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  title: { color: "#e2e8f0", fontWeight: "700", marginTop: 12, marginBottom: 8 },
  body: { color: "#cbd5e1", marginTop: 8 },
  hint: { color: "#94a3b8", fontSize: 13, marginBottom: 8 },
  error: { color: "#fca5a5", marginBottom: 8 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#0f172a" },
  layerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    flexWrap: "wrap"
  },
  layerLabel: { flex: 1, color: "#e2e8f0", minWidth: 120 },
  layerSelected: { color: "#fdba74", fontWeight: "700" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  checkpointRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    gap: 8
  },
  mono: { color: "#cbd5e1", fontFamily: "Menlo", flex: 1 }
});
