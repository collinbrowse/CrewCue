import { Camera, Map as MapLibreMap, type ViewStateChangeEvent } from "@maplibre/maplibre-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { NativeSyntheticEvent, StyleSheet, Text, View } from "react-native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSButton } from "../design-system";
import { mobileMapStyleUrlForPreset } from "../features/maps/mapStyleUrl";
import type { BasemapPresetId } from "../preferences/basemapPreference";
import { getBasemapPreset } from "../preferences/basemapPreference";
import type { CrewMainTabParamList, MapStackParamList } from "./types";

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<MapStackParamList, "CheckpointPickMap">,
  BottomTabNavigationProp<CrewMainTabParamList>
>;

export function CheckpointPickMapScreen(): ReactElement {
  const navigation = useNavigation<Nav>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const [basemapPreset, setBasemapPreset] = useState<BasemapPresetId>("outdoor");
  useEffect(() => {
    void getBasemapPreset().then(setBasemapPreset);
  }, []);
  const params = (route.params ?? {}) as {
    initialLatitude?: number;
    initialLongitude?: number;
  };
  const initialCenter = useMemo<[number, number]>(() => {
    const lat = params.initialLatitude;
    const lng = params.initialLongitude;
    if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) {
      return [lng, lat];
    }
    return [-98.5795, 39.8283];
  }, [params.initialLatitude, params.initialLongitude]);

  const [center, setCenter] = useState<[number, number]>(initialCenter);

  const onRegionDidChange = useCallback((e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const ev = e.nativeEvent;
    if (ev.center && ev.center.length >= 2) {
      const [lng, lat] = ev.center;
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        setCenter([lng, lat]);
      }
    }
  }, []);

  const onConfirm = useCallback(() => {
    const [lng, lat] = center;
    navigation.navigate("Pace", {
      screen: "ReadoutsHome",
      params: { pacePickResult: { latitude: lat, longitude: lng } }
    });
  }, [center, navigation]);

  const onCancel = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.root}>
      <MapLibreMap
        style={styles.map}
        mapStyle={mobileMapStyleUrlForPreset(basemapPreset)}
        onRegionDidChange={onRegionDidChange}
      >
        <Camera initialViewState={{ center: initialCenter, zoom: 13 }} />
      </MapLibreMap>
      <View style={styles.crosshair} pointerEvents="none">
        <View style={styles.crosshairV} />
        <View style={styles.crosshairH} />
      </View>
      <View style={[styles.chrome, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.hint}>Pan and zoom — the crosshair marks the new checkpoint.</Text>
        <Text style={styles.coords}>
          {center[1].toFixed(5)}, {center[0].toFixed(5)}
        </Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <DSButton preset="secondary" onPress={onCancel}>
              Cancel
            </DSButton>
          </View>
          <View style={{ flex: 1 }}>
            <DSButton preset="primary" onPress={onConfirm}>
              Use this location
            </DSButton>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  map: { ...StyleSheet.absoluteFillObject },
  crosshair: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center" },
  crosshairV: {
    position: "absolute",
    width: 2,
    height: 28,
    backgroundColor: "rgba(250, 204, 21, 0.95)"
  },
  crosshairH: {
    position: "absolute",
    height: 2,
    width: 28,
    backgroundColor: "rgba(250, 204, 21, 0.95)"
  },
  chrome: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.92)",
    paddingHorizontal: 16,
    gap: 8
  },
  hint: { color: "#e2e8f0", fontSize: 14 },
  coords: { color: "#94a3b8", fontSize: 12, fontFamily: "Menlo" },
  row: { flexDirection: "row", gap: 10, marginTop: 4 }
});
