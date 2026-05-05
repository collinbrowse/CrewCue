import { Ionicons } from "@expo/vector-icons";
import { Camera, GeoJSONSource, Layer, Map } from "@maplibre/maplibre-react-native";
import type { RaceMapWorkspace, RaceRoom } from "@crewcue/contracts";
import {
  elevationSamplesFromWorkspacePolyline,
  formatPace,
  latLngAtDistanceAlongCheckpointCourse,
  lngLatAtDistanceAlongPolyline,
  primaryCourseLngLatPolyline,
  remainingGainAndLossMetersAfter
} from "@crewcue/map-core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import type { NativeSyntheticEvent } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSButton } from "../design-system";
import { useDSTheme } from "../design-system/theme";
import { mobileMapStyleUrlForPreset } from "../features/maps/mapStyleUrl";
import type { BasemapPresetId } from "../preferences/basemapPreference";
import { getBasemapPreset, setBasemapPreset } from "../preferences/basemapPreference";
import { useAuthedShell } from "../shell/AuthedShellContext";
import { RacePickerOverlay } from "./RacePickerOverlay";
import { TOOLTIP_SHEET_SEAM_OVERLAP } from "./racePickerLayoutConstants";
import type { CrewMainTabParamList, MapStackParamList } from "./types";

const WINDOW = Dimensions.get("window");
const RACE_PICKER_WIDTH_RATIO = 0.92;
const HEADER_INNER = 52;
const RACE_CARD_TOP_BLOCK = 76;
const RACE_CARD_FOOTER_BLOCK = 58;
const RACE_CARD_INNER_PADDING_V = 18;

type WindowRect = { x: number; y: number; width: number; height: number };

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<MapStackParamList, "MapHome">,
  BottomTabNavigationProp<CrewMainTabParamList>
>;

function resolveWorkspaceFromRoom(room: RaceRoom | undefined): RaceMapWorkspace {
  if (!room) {
    return { layers: [], checkpoints: [] };
  }
  if (room.mapWorkspace) {
    return room.mapWorkspace;
  }
  return {
    layers: [],
    checkpoints: room.course?.checkpoints?.map((c) => ({ ...c })) ?? []
  };
}

function formatPingAgo(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return "—";
  }
  if (seconds < 90) {
    return `${Math.max(1, Math.round(seconds))} sec ago`;
  }
  const min = Math.round(seconds / 60);
  return `${min} min ago`;
}

function checkpointLabel(room: RaceRoom | undefined, checkpointId: string): string {
  const cp = room?.course?.checkpoints?.find((c) => c.id === checkpointId);
  return cp?.id ?? checkpointId;
}

export function TrackMapDashboardScreen(): ReactElement {
  const s = useAuthedShell();
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const room = s.room;
  const inRace = Boolean(room);
  const projection = s.projection;
  const workspace = useMemo(() => resolveWorkspaceFromRoom(room), [room]);

  const [basemapPreset, setBasemapPresetState] = useState<BasemapPresetId>("outdoor");
  const [layersOpen, setLayersOpen] = useState(false);
  const [followRunner, setFollowRunner] = useState(true);
  const [mapCenter, setMapCenter] = useState<[number, number]>([-98.5795, 39.8283]);
  const [mapZoom] = useState(13);
  const [showRaceSelectorModal, setShowRaceSelectorModal] = useState(false);
  const [raceTitleRect, setRaceTitleRect] = useState<WindowRect | null>(null);
  const raceTitleRef = useRef<View>(null);

  const SHEET_H = Math.min(WINDOW.height * 0.9, WINDOW.height - insets.top);
  const PEEK = 210;
  const maxSheetTranslate = Math.max(0, SHEET_H - PEEK);
  const midSheetTranslate = maxSheetTranslate * 0.48;
  const snapPoints = useMemo(() => [0, midSheetTranslate, maxSheetTranslate], [midSheetTranslate, maxSheetTranslate]);
  const [sheetTranslate, setSheetTranslate] = useState(maxSheetTranslate);
  const sheetDragStart = useRef(maxSheetTranslate);
  const sheetTranslateRef = useRef(sheetTranslate);
  sheetTranslateRef.current = sheetTranslate;

  useEffect(() => {
    void getBasemapPreset().then(setBasemapPresetState);
  }, []);

  useFocusEffect(
    useCallback(() => {
      s.onSetProjectionPollEnabled(true);
      s.onFetchProjection();
      return () => {
        s.onSetProjectionPollEnabled(false);
      };
    }, [s.onFetchProjection, s.onSetProjectionPollEnabled])
  );

  useEffect(() => {
    if (!inRace || !room) {
      return;
    }
    void s.onFetchRoomDetails(room.id);
    void s.onFetchInvites();
  }, [inRace, room?.id, s]);

  const courseLine = useMemo(() => primaryCourseLngLatPolyline(room?.course, workspace), [room?.course, workspace]);
  const routeFeature = useMemo(() => {
    if (courseLine.length < 2) {
      return null;
    }
    return {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: courseLine }
    };
  }, [courseLine]);

  const athletePos = useMemo(() => {
    if (!room?.course || projection === undefined) {
      return null;
    }
    const fromCp = latLngAtDistanceAlongCheckpointCourse(room.course, projection.progressMeters);
    if (fromCp) {
      return fromCp;
    }
    if (courseLine.length >= 2) {
      const ll = lngLatAtDistanceAlongPolyline(courseLine, projection.progressMeters);
      if (ll) {
        return { latitude: ll[1], longitude: ll[0] };
      }
    }
    return null;
  }, [room?.course, projection, courseLine]);

  const athleteFeature = useMemo(() => {
    if (!athletePos) {
      return null;
    }
    return {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Point" as const, coordinates: [athletePos.longitude, athletePos.latitude] as [number, number] }
    };
  }, [athletePos]);

  useEffect(() => {
    if (!followRunner || !athletePos) {
      return;
    }
    setMapCenter([athletePos.longitude, athletePos.latitude]);
  }, [followRunner, athletePos?.latitude, athletePos?.longitude]);

  const onRegionDidChange = useCallback((e: NativeSyntheticEvent<{ userInteraction?: boolean }>) => {
    const ui = e.nativeEvent?.userInteraction;
    if (ui) {
      setFollowRunner(false);
    }
  }, []);

  const selectedRace = room;
  const roomsForRacePicker = useMemo(() => {
    const list = s.myRaceRooms ?? [];
    const current = s.room;
    if (!current) {
      return list;
    }
    if (list.some((r) => r.id === current.id)) {
      return list;
    }
    return [current, ...list];
  }, [s.myRaceRooms, s.room]);

  const raceBuckets = useMemo(() => {
    const now = Date.now();
    const all = roomsForRacePicker;
    const withoutSelected = all.filter((r) => r.id !== selectedRace?.id);
    const current: typeof withoutSelected = [];
    const upcoming: typeof withoutSelected = [];
    const past: typeof withoutSelected = [];
    for (const r of withoutSelected) {
      const endMs = r.eventEndsAt ? Date.parse(r.eventEndsAt) : undefined;
      if (r.status === "active" && (endMs === undefined || endMs >= now)) {
        current.push(r);
      } else if (endMs !== undefined && endMs < now) {
        past.push(r);
      } else {
        upcoming.push(r);
      }
    }
    return { current, upcoming, past };
  }, [roomsForRacePicker, selectedRace?.id]);

  const syncRaceTitleRect = useCallback(() => {
    raceTitleRef.current?.measureInWindow((x, y, w, h) => {
      setRaceTitleRect({ x, y, width: w, height: h });
    });
  }, []);

  useEffect(() => {
    if (!showRaceSelectorModal) {
      setRaceTitleRect(null);
      return;
    }
    const t = requestAnimationFrame(() => {
      syncRaceTitleRect();
      requestAnimationFrame(syncRaceTitleRect);
    });
    return () => cancelAnimationFrame(t);
  }, [showRaceSelectorModal, selectedRace?.name, syncRaceTitleRect]);

  const headerBottomY = insets.top + HEADER_INNER;
  const raceSelectorMaxHeight = WINDOW.height * 0.5;
  const raceSelectorScrollMaxHeight = Math.max(
    120,
    raceSelectorMaxHeight - RACE_CARD_INNER_PADDING_V - RACE_CARD_TOP_BLOCK - RACE_CARD_FOOTER_BLOCK
  );
  const racePanelLayout = useMemo(() => {
    const panelW = WINDOW.width * RACE_PICKER_WIDTH_RATIO;
    return {
      left: Math.round((WINDOW.width - panelW) / 2),
      width: Math.round(panelW),
      top: headerBottomY - TOOLTIP_SHEET_SEAM_OVERLAP
    };
  }, [headerBottomY]);

  const nextSplit = useMemo(() => {
    const splits = projection?.checkpointSplits ?? [];
    return splits.find((row) => row.crossedAtRecordedAt === null) ?? splits[splits.length - 1];
  }, [projection?.checkpointSplits]);

  const nextCheckpointLabel = useMemo(() => {
    if (!nextSplit || !room) {
      return "—";
    }
    return checkpointLabel(room, nextSplit.checkpointId);
  }, [nextSplit, room]);

  const remainingDistM = useMemo(() => {
    if (!projection) {
      return null;
    }
    return Math.max(0, projection.courseLengthMeters - projection.progressMeters);
  }, [projection]);

  const remainingMi = remainingDistM !== null ? remainingDistM / 1609.344 : null;

  const vertSummary = useMemo(() => {
    if (!projection || !room) {
      return null;
    }
    const samples = elevationSamplesFromWorkspacePolyline(workspace);
    if (!samples || samples.length < 2) {
      return null;
    }
    const sampleEnd = samples[samples.length - 1]!.distanceMetersFromStart;
    const courseLen = projection.courseLengthMeters > 0 ? projection.courseLengthMeters : sampleEnd;
    const ratio = courseLen > 0 ? sampleEnd / courseLen : 1;
    const dAlong = projection.progressMeters * ratio;
    return remainingGainAndLossMetersAfter(samples, dAlong);
  }, [projection, room, workspace]);

  const vertDisplay = useMemo(() => {
    if (!vertSummary) {
      return { text: "—", sub: "" };
    }
    const gain = vertSummary.gainRemainingMeters;
    const loss = vertSummary.lossRemainingMeters;
    if (gain >= 0.5) {
      const ft = Math.round(gain * 3.28084);
      return { text: `+${ft.toLocaleString()} FT`, sub: "gain left" };
    }
    if (loss >= 0.5) {
      const ft = Math.round(loss * 3.28084);
      return { text: `-${ft.toLocaleString()} FT`, sub: "loss left" };
    }
    return { text: "0 FT", sub: "flat" };
  }, [vertSummary]);

  const paceLabel = useMemo(() => {
    if (!projection?.plannedPaceSecondsPerKm) {
      return "—";
    }
    return `${formatPace(projection.plannedPaceSecondsPerKm, "mi")} / MI`;
  }, [projection?.plannedPaceSecondsPerKm]);

  const etaNextLabel = useMemo(() => {
    if (!projection || !nextSplit || remainingDistM === null) {
      return { time: "—", remain: "—" };
    }
    const pace = projection.plannedPaceSecondsPerKm;
    if (!Number.isFinite(pace) || pace <= 0) {
      return { time: "—", remain: "—" };
    }
    const distToNext = Math.max(0, nextSplit.distanceMetersFromStart - projection.progressMeters);
    const secondsToNext = (distToNext / 1000) * pace;
    const etaMs = Date.now() + secondsToNext * 1000;
    const t = new Date(etaMs);
    const timeStr = t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const remainMin = Math.max(1, Math.round(secondsToNext / 60));
    const h = Math.floor(remainMin / 60);
    const m = remainMin % 60;
    const remainStr = h > 0 ? `${h}H ${m}M` : `${m}M`;
    return { time: timeStr, remain: remainStr };
  }, [projection, nextSplit, remainingDistM]);

  const onTrackLabel = projection?.projectionConfidence === "fresh" ? "ON TRACK" : "DEGRADED";

  const pickBasemap = async (preset: BasemapPresetId) => {
    setBasemapPresetState(preset);
    await setBasemapPreset(preset);
    setLayersOpen(false);
  };

  const snapSheet = useCallback(
    (y: number) => {
      const nearest = snapPoints.reduce((best, p) => (Math.abs(p - y) < Math.abs(best - y) ? p : best), snapPoints[0]!);
      setSheetTranslate(nearest);
    },
    [snapPoints]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          sheetDragStart.current = sheetTranslateRef.current;
        },
        onPanResponderMove: (_, g) => {
          const next = Math.max(0, Math.min(maxSheetTranslate, sheetDragStart.current + g.dy));
          setSheetTranslate(next);
        },
        onPanResponderRelease: (_, g) => {
          const next = Math.max(0, Math.min(maxSheetTranslate, sheetDragStart.current + g.dy));
          snapSheet(next + g.vy * 0.08);
        }
      }),
    [maxSheetTranslate, snapSheet]
  );

  const cycleSheet = () => {
    let bestI = 0;
    for (let i = 0; i < snapPoints.length; i += 1) {
      if (Math.abs(snapPoints[i]! - sheetTranslate) < Math.abs(snapPoints[bestI]! - sheetTranslate)) {
        bestI = i;
      }
    }
    setSheetTranslate(snapPoints[(bestI + 1) % snapPoints.length]!);
  };

  const onMapDidFailLoading = useCallback(() => {
    if (basemapPreset !== "outdoor") {
      setBasemapPresetState("outdoor");
      void setBasemapPreset("outdoor");
    }
  }, [basemapPreset]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.color.background },
        map: { ...StyleSheet.absoluteFillObject },
        header: {
          position: "absolute",
          top: insets.top,
          left: 0,
          right: 0,
          height: HEADER_INNER,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          zIndex: 20
        },
        headerTitleWrap: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 8
        },
        badgeRow: {
          position: "absolute",
          top: insets.top + HEADER_INNER + 8,
          left: 12,
          right: 12,
          flexDirection: "row",
          justifyContent: "space-between",
          zIndex: 19
        },
        badgeOnTrack: {
          backgroundColor: theme.color.primary,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 999
        },
        badgeOnTrackText: { color: theme.color.card, fontWeight: "800", fontSize: 11 },
        badgePing: {
          backgroundColor: theme.color.card,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 999,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.color.border
        },
        badgePingText: { color: theme.color.primary, fontWeight: "700", fontSize: 11 },
        fabCol: {
          position: "absolute",
          right: 14,
          bottom: SHEET_H - sheetTranslate + 16,
          gap: 12,
          zIndex: 18,
          alignItems: "flex-end"
        },
        fab: {
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: theme.color.card,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.color.border,
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 6,
          elevation: 3
        },
        sheet: {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: SHEET_H,
          backgroundColor: theme.color.card,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingTop: 8,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: theme.color.border,
          zIndex: 25,
          transform: [{ translateY: sheetTranslate }]
        },
        handle: {
          alignSelf: "center",
          width: 40,
          height: 5,
          borderRadius: 3,
          backgroundColor: theme.color.muted,
          marginBottom: 10
        },
        emptyWrap: { flex: 1, padding: 16, justifyContent: "center" },
        statsRow: {
          flexDirection: "row",
          marginTop: 12,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.color.divider,
          paddingTop: 12
        },
        statCol: { flex: 1, alignItems: "center" },
        statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: theme.color.divider },
        statLabel: { fontSize: 11, color: theme.color.muted, marginBottom: 4 },
        statValue: { fontSize: 16, fontWeight: "800", color: theme.color.text },
        checklistTitle: { marginTop: 16, fontWeight: "700", color: theme.color.text },
        checklistRow: {
          marginTop: 10,
          paddingBottom: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.color.divider
        }
      }),
    [insets.top, SHEET_H, sheetTranslate, theme]
  );

  if (!inRace) {
    return (
      <ScrollView style={s.styles.container} contentContainerStyle={[s.styles.scroll, styles.emptyWrap]}>
        <View style={{ marginBottom: 12 }}>
          <Text style={s.styles.title}>CrewCue</Text>
          <Text style={s.styles.subtitle}>Select or create a race to open the live map.</Text>
        </View>
        <DSButton preset="primary" onPress={() => navigation.navigate("RacePlanning", { mode: "create" })}>
          Race setup
        </DSButton>
        <View style={{ height: 12 }} />
        <DSButton preset="secondary" onPress={() => navigation.navigate("WorkspaceMenu")}>
          Workspace menu
        </DSButton>
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      <Map
        key={`dash-${basemapPreset}`}
        style={styles.map}
        mapStyle={mobileMapStyleUrlForPreset(basemapPreset)}
        onRegionDidChange={onRegionDidChange}
        onDidFailLoadingMap={onMapDidFailLoading}
      >
        <Camera zoom={mapZoom} center={mapCenter} duration={followRunner ? 0 : 200} />
        {routeFeature ? (
          <GeoJSONSource id="dash-route" data={routeFeature}>
            <Layer id="dash-route-line" type="line" style={{ lineColor: "#ffffff", lineWidth: 5, lineOpacity: 0.95 }} />
          </GeoJSONSource>
        ) : null}
        {athleteFeature ? (
          <GeoJSONSource id="dash-athlete" data={athleteFeature}>
            <Layer
              id="dash-athlete-circle"
              type="circle"
              style={{
                circleRadius: 10,
                circleColor: theme.color.primary,
                circleStrokeWidth: 3,
                circleStrokeColor: "#ffffff"
              }}
            />
          </GeoJSONSource>
        ) : null}
      </Map>

      <View style={styles.header} pointerEvents="box-none">
        <Pressable
          onPress={() => navigation.getParent()?.navigate("Profile")}
          style={{ padding: 6 }}
          accessibilityRole="button"
          accessibilityLabel="Open profile"
        >
          <Image
            source={require("../../assets/onboarding/crew-cue-onboarding-runner.png")}
            style={{ width: 40, height: 40, borderRadius: 20 }}
          />
        </Pressable>
        <View ref={raceTitleRef} collapsable={false} style={styles.headerTitleWrap}>
          <Pressable
            onPress={() => {
              setShowRaceSelectorModal((open) => {
                const next = !open;
                if (next) {
                  void s.onFetchMyRaceRooms();
                }
                return next;
              });
            }}
            style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <Text style={{ color: theme.color.primary, fontSize: 18, fontWeight: "800" }} numberOfLines={1}>
              {selectedRace?.name?.trim() ? selectedRace.name : "CrewCue"}
            </Text>
            <Text style={{ color: theme.color.primary, fontSize: 14, fontWeight: "800" }}>
              {showRaceSelectorModal ? "▲" : "▼"}
            </Text>
          </Pressable>
        </View>
        <Pressable onPress={() => navigation.navigate("WorkspaceMenu")} style={{ padding: 6 }} accessibilityLabel="Workspace menu">
          <Ionicons name="settings-outline" size={26} color={theme.color.primary} />
        </Pressable>
      </View>

      <View style={styles.badgeRow} pointerEvents="none">
        <View style={styles.badgeOnTrack}>
          <Text style={styles.badgeOnTrackText}>{onTrackLabel}</Text>
        </View>
        <View style={styles.badgePing}>
          <Text style={styles.badgePingText}>
            ● LAST PING: {formatPingAgo(projection?.secondsSinceLastAcceptedPing)} 
          </Text>
        </View>
      </View>

      <View style={styles.fabCol} pointerEvents="box-none">
        <Pressable
          style={styles.fab}
          onPress={() => {
            setFollowRunner(true);
            if (athletePos) {
              setMapCenter([athletePos.longitude, athletePos.latitude]);
            }
          }}
          accessibilityLabel="Follow runner"
        >
          <Ionicons name="locate" size={22} color={theme.color.primary} />
        </Pressable>
        <Pressable style={styles.fab} onPress={() => setLayersOpen(true)} accessibilityLabel="Map layers">
          <Ionicons name="layers-outline" size={22} color={theme.color.primary} />
        </Pressable>
      </View>

      <View style={styles.sheet}>
        <View {...panResponder.panHandlers}>
          <Pressable onPress={cycleSheet} accessibilityRole="button" accessibilityLabel="Expand sheet">
            <View style={styles.handle} />
          </Pressable>
        </View>
        <ScrollView
          style={{ flex: 1, paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          scrollEnabled={sheetTranslate < maxSheetTranslate - 2}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={{ color: theme.color.primary, fontSize: 11, fontWeight: "700" }}>NEXT AID STATION</Text>
              <Text style={{ color: theme.color.text, fontSize: 20, fontWeight: "800", marginTop: 4 }}>{nextCheckpointLabel}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ color: theme.color.primary, fontSize: 22, fontWeight: "800" }}>{etaNextLabel.time}</Text>
              <Text style={{ color: theme.color.text, fontSize: 11, marginTop: 2 }}>EST. ARRIVAL</Text>
              <View
                style={{
                  marginTop: 6,
                  backgroundColor: `${theme.color.primary}22`,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 999
                }}
              >
                <Text style={{ color: theme.color.primary, fontWeight: "800", fontSize: 12 }}>{etaNextLabel.remain}</Text>
              </View>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>DISTANCE</Text>
              <Text style={styles.statValue}>{remainingMi !== null ? `${remainingMi.toFixed(1)} MI` : "—"}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>ELEVATION</Text>
              <Text style={styles.statValue}>{vertDisplay.text}</Text>
              {vertDisplay.sub ? <Text style={{ fontSize: 10, color: theme.color.muted }}>{vertDisplay.sub}</Text> : null}
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>PACE</Text>
              <Text style={styles.statValue} numberOfLines={2}>
                {paceLabel}
              </Text>
            </View>
          </View>

          <Text style={styles.checklistTitle}>Aid station checklist</Text>
          {(projection?.checkpointSplits ?? []).map((row) => {
            const label = checkpointLabel(room, row.checkpointId);
            const crossed = row.crossedAtRecordedAt ? new Date(row.crossedAtRecordedAt).toLocaleTimeString() : "Pending";
            return (
              <View key={row.checkpointId} style={styles.checklistRow}>
                <Text style={{ fontWeight: "700", color: theme.color.text }}>{label}</Text>
                <Text style={{ color: theme.color.muted, marginTop: 4, fontSize: 13 }}>
                  {crossed} · Stop plan {Math.round(row.plannedStopSeconds / 60)}m
                </Text>
              </View>
            );
          })}
          {projection?.checkpointSplits?.length ? null : (
            <Text style={{ color: theme.color.muted, marginTop: 8 }}>No checkpoint splits yet for this room.</Text>
          )}

          <View style={{ marginTop: 20, gap: 8 }}>
            <DSButton preset="secondary" onPress={() => navigation.navigate("MapWorkspace")}>
              Map workspace
            </DSButton>
            <DSButton preset="secondary" onPress={() => navigation.navigate("Navigate")}>
              Navigate
            </DSButton>
            <DSButton preset="secondary" onPress={() => navigation.navigate("RacePlanning", { mode: "edit" })}>
              Race setup
            </DSButton>
          </View>
        </ScrollView>
      </View>

      <Modal visible={layersOpen} transparent animationType="fade" onRequestClose={() => setLayersOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setLayersOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "#0006", justifyContent: "flex-end" }}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View
                style={{
                  backgroundColor: theme.color.card,
                  padding: 20,
                  borderTopLeftRadius: 16,
                  borderTopRightRadius: 16
                }}
              >
                <Text style={{ fontWeight: "800", color: theme.color.text, marginBottom: 12 }}>Map layer</Text>
                {(["outdoor", "streets", "satellite"] as const).map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => void pickBasemap(p)}
                    style={{
                      paddingVertical: 14,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: theme.color.divider
                    }}
                  >
                    <Text style={{ color: theme.color.text, fontWeight: basemapPreset === p ? "800" : "500" }}>
                      {p[0]!.toUpperCase() + p.slice(1)}
                      {basemapPreset === p ? " ✓" : ""}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <RacePickerOverlay
        visible={showRaceSelectorModal}
        panelLayout={racePanelLayout}
        titleHitRect={raceTitleRect}
        maxSheetHeight={raceSelectorMaxHeight}
        scrollMaxHeight={raceSelectorScrollMaxHeight}
        selectedRace={selectedRace}
        buckets={raceBuckets}
        onClose={() => setShowRaceSelectorModal(false)}
        onSelectRoom={(r) => {
          void s.onSelectRaceRoom(r);
          setShowRaceSelectorModal(false);
        }}
      />
    </View>
  );
}
