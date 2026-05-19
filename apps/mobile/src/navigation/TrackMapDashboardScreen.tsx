import { Ionicons } from "@expo/vector-icons";
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  Marker,
  type MapRef,
  type ViewPadding,
  type ViewStateChangeEvent
} from "@maplibre/maplibre-react-native";
import type { RaceMapWorkspace, RaceRoom, RaceRoomProjection } from "@crewcue/contracts";
import {
  buildExpectedAidStationSplitsFromCourse,
  elevationSamplesFromWorkspacePolyline,
  formatPace,
  latLngAtDistanceAlongCheckpointCourse,
  lngLatAtDistanceAlongPolyline,
  primaryCourseLngLatPolyline,
  remainingGainAndLossMetersAfter
} from "@crewcue/map-core";
import * as Location from "expo-location";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";

const LOCATE_ACCENT = "#2563eb";
type UserLocateVisual = "default" | "locating" | "latched";
import { appNoticeBus } from "../platform/runtime";
import { useAction } from "../platform/useAction";
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  PixelRatio,
  Image,
  LayoutChangeEvent,
  Linking,
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
import { createApiClient } from "../api/client";
import { DSButton } from "../design-system";
import { useDSTheme, useDesignSystemSelection } from "../design-system/theme";
import { formatEtaClock, formatRemainingMinutes, secondsForDistance } from "../features/readouts/eta";
import { formatElapsedHoursMinutes } from "../features/pace/timeline";
import type { BasemapPreviewLayout } from "../features/maps/mapStyleUrl";
import { basemapPreviewLayout, mobileMapStyleUrlForPreset } from "../features/maps/mapStyleUrl";
import type { BasemapPresetId } from "../preferences/basemapPreference";
import { getBasemapPreset, setBasemapPreset } from "../preferences/basemapPreference";
import { useAuthedShell } from "../shell/AuthedShellContext";
import { RacePickerOverlay } from "./RacePickerOverlay";
import { TOOLTIP_SHEET_SEAM_OVERLAP } from "./racePickerLayoutConstants";
import type { CrewMainTabParamList, MapStackParamList } from "./types";

const WINDOW = Dimensions.get("window");

/** Scale + offset a square tile bitmap so `layout`’s map center sits at the center of a W×H preview (overflow hidden). */
function basemapPreviewImageFrame(
  W: number,
  H: number,
  layout: BasemapPreviewLayout
): { width: number; height: number; left: number; top: number } {
  const { intrinsicSize, oxPx, oyPx } = layout;
  const s = Math.max(W / intrinsicSize, H / intrinsicSize);
  const width = intrinsicSize * s;
  const height = intrinsicSize * s;
  return {
    width,
    height,
    left: W / 2 - oxPx * s,
    top: H / 2 - oyPx * s
  };
}
const RACE_PICKER_WIDTH_RATIO = 0.92;
const HEADER_INNER = 52;
/** Matches `badgeRow` offset under header (`top: insets.top + HEADER_INNER + …`). */
const BADGE_ROW_GAP_BELOW_HEADER = 8;
/**
 * Fallback distance from bottom of header to bottom of badge strip (matches `courseFitPadding.top`
 * until `measureInWindow` runs). Keep in sync with badge layout + typography.
 */
const BADGE_STRIP_FALLBACK_BELOW_HEADER = 44;
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
  const t = cp?.title?.trim();
  if (t) {
    return t;
  }
  return cp?.id ?? checkpointId;
}

function parseRaceAnchorMs(room: RaceRoom | undefined): number | null {
  const raw = room?.raceStartAt ?? room?.activatedAt;
  if (!raw) {
    return null;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** Next aid along the course: prefer WS2 split rows; otherwise infer from checkpoint arc distances + progress. */
function resolveNextCheckpointForMapSheet(
  room: RaceRoom | undefined,
  projection: RaceRoomProjection | undefined,
  checkpointDistanceById: Map<string, number>
): { checkpointId: string; distanceMetersFromStart: number; crossedAtRecordedAt: string | null } | null {
  const cps = room?.course?.checkpoints;
  if (!cps?.length) {
    return null;
  }
  const splits = projection?.checkpointSplits ?? [];
  if (splits.length > 0) {
    const row = splits.find((r) => r.crossedAtRecordedAt === null) ?? splits[splits.length - 1];
    if (!row) {
      return null;
    }
    const fromCourse = checkpointDistanceById.get(row.checkpointId);
    const distanceMetersFromStart =
      typeof fromCourse === "number" && Number.isFinite(fromCourse) ? fromCourse : row.distanceMetersFromStart;
    return {
      checkpointId: row.checkpointId,
      distanceMetersFromStart,
      crossedAtRecordedAt: row.crossedAtRecordedAt
    };
  }
  const progressMeters = projection?.progressMeters ?? 0;
  for (const cp of cps) {
    const d = checkpointDistanceById.get(cp.id);
    if (d === undefined || !Number.isFinite(d)) {
      continue;
    }
    if (d > progressMeters + 5) {
      return { checkpointId: cp.id, distanceMetersFromStart: d, crossedAtRecordedAt: null };
    }
  }
  const lastCp = cps[cps.length - 1]!;
  const lastD = checkpointDistanceById.get(lastCp.id) ?? progressMeters;
  return { checkpointId: lastCp.id, distanceMetersFromStart: lastD, crossedAtRecordedAt: null };
}

function mergeWorkspaceFromServer(room: RaceRoom | undefined, server: RaceMapWorkspace | null): RaceMapWorkspace {
  const base = resolveWorkspaceFromRoom(room);
  if (!server) {
    return base;
  }
  return {
    layers: server.layers.length > 0 ? server.layers : base.layers,
    checkpoints: server.checkpoints.length > 0 ? server.checkpoints : base.checkpoints,
    selectedLayerId: server.selectedLayerId ?? base.selectedLayerId,
    drivesProjectionLayerId: server.drivesProjectionLayerId ?? base.drivesProjectionLayerId
  };
}

/** West, south, east, north with fractional padding on span. */
function paddedLngLatBounds(coords: [number, number][], padFrac: number): [number, number, number, number] | null {
  if (coords.length < 2) {
    return null;
  }
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const spanLng = Math.max(maxLng - minLng, 1e-6);
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const padLng = spanLng * padFrac;
  const padLat = spanLat * padFrac;
  return [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat];
}

export function TrackMapDashboardScreen(): ReactElement {
  const s = useAuthedShell();
  const { execute: executeCenterOnUser } = useAction<void>("map:center-user", "replace");
  const [userLocateVisual, setUserLocateVisual] = useState<UserLocateVisual>("default");
  const locatePulse = useRef(new Animated.Value(1)).current;
  const locatePulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const theme = useDSTheme();
  const { activeMode } = useDesignSystemSelection();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const room = s.room;
  const inRace = Boolean(room);
  const projection = s.projection;
  const lastPing = s.lastPing;
  const projectionPolledAt = s.projectionPolledAt;
  const roomId = room?.id;
  const token = s.auth.status === "authenticated" ? s.auth.accessToken : undefined;

  /**
   * `listMyRaceRooms` snapshots often omit `raceStartAt`; GET room detail includes it.
   * Schedule-sensitive map UI must read the anchor from detail when the ids match.
   */
  const scheduleRoom = useMemo((): RaceRoom | undefined => {
    if (!room) {
      return undefined;
    }
    const dRoom = s.roomDetail?.room;
    if (dRoom && dRoom.id === room.id) {
      return {
        ...room,
        raceStartAt: dRoom.raceStartAt ?? room.raceStartAt,
        activatedAt: dRoom.activatedAt ?? room.activatedAt,
        eventEndsAt: dRoom.eventEndsAt ?? room.eventEndsAt
      };
    }
    return room;
  }, [room, s.roomDetail?.room]);

  const startCheckpointTitle = useMemo(() => {
    const r = scheduleRoom;
    const first = r?.course?.checkpoints?.[0];
    if (!first) {
      return "Start";
    }
    return checkpointLabel(r, first.id);
  }, [scheduleRoom]);

  const [serverWorkspace, setServerWorkspace] = useState<RaceMapWorkspace | null>(null);
  const workspace = useMemo(() => mergeWorkspaceFromServer(room, serverWorkspace), [room, serverWorkspace]);

  const [basemapPreset, setBasemapPresetState] = useState<BasemapPresetId>("outdoor");
  const [layersOpen, setLayersOpen] = useState(false);
  const [failedBasemapPreviews, setFailedBasemapPreviews] = useState<string[]>([]);
  const layerPanelWidth = Math.round((WINDOW.width * 2) / 3);
  const layerSlideX = useRef(new Animated.Value(layerPanelWidth)).current;

  const [followRunner, setFollowRunner] = useState(true);
  const [courseBounds, setCourseBounds] = useState<[number, number, number, number] | null>(null);
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const lastCourseFitKeyRef = useRef<string | null>(null);
  const [showRaceSelectorModal, setShowRaceSelectorModal] = useState(false);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string | null>(null);
  const [raceTitleRect, setRaceTitleRect] = useState<WindowRect | null>(null);
  const raceTitleRef = useRef<View>(null);
  const rootRef = useRef<View>(null);
  const badgeRowRef = useRef<View>(null);
  const [rootBottomAbs, setRootBottomAbs] = useState<number | null>(null);
  const [badgeBottomAbs, setBadgeBottomAbs] = useState<number | null>(null);

  /** Tab content is shorter than `Dimensions` window height; anchor sheet + FABs to this view's bottom in window space. */
  const updateChromeLayoutMetrics = useCallback(() => {
    requestAnimationFrame(() => {
      rootRef.current?.measureInWindow((_, y, __, h) => {
        setRootBottomAbs(Math.round(y + h));
      });
      badgeRowRef.current?.measureInWindow((_, y, __, h) => {
        setBadgeBottomAbs(Math.round(y + h));
      });
    });
  }, []);

  /** Handle row: `styles.sheet` paddingTop + `styles.handle` + handle marginBottom, plus a little gap before body. */
  const SHEET_HANDLE_STACK_PX = 31;
  const [sheetPeekPx, setSheetPeekPx] = useState(210);
  const badgeBottomFallbackY = insets.top + HEADER_INNER + BADGE_STRIP_FALLBACK_BELOW_HEADER;
  /** Fully expanded: top of sheet = bottom of ON TRACK / LAST PING + same gap as under header. */
  const expandedSheetTopY = (badgeBottomAbs ?? badgeBottomFallbackY) + BADGE_ROW_GAP_BELOW_HEADER;
  const sheetAnchorBottomY = rootBottomAbs ?? WINDOW.height;
  /** Sheet uses `bottom: 0` to the tab content root; do not subtract `insets.bottom` here (that was double-counting vs sheet `bottom`). */
  const SHEET_H = Math.max(220, Math.max(sheetPeekPx + 1, sheetAnchorBottomY - expandedSheetTopY));
  const maxSheetTranslate = Math.max(0, SHEET_H - sheetPeekPx);
  const [sheetTranslate, setSheetTranslate] = useState(maxSheetTranslate);
  const sheetDragStart = useRef(maxSheetTranslate);
  const sheetTranslateRef = useRef(sheetTranslate);
  sheetTranslateRef.current = sheetTranslate;
  const sheetAnimRafRef = useRef<number | null>(null);

  /** Collapsed sheet uses positive `translateY`, so the **top** of the panel stays on-screen — stats must sit above the checklist. */
  const hideChecklistInPeek =
    maxSheetTranslate < 6 ? false : sheetTranslate > maxSheetTranslate * 0.82;

  const onSheetPeekSectionLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const fh = e.nativeEvent.layout.height;
      const raw = Math.round(SHEET_HANDLE_STACK_PX + fh);
      const span = sheetAnchorBottomY - expandedSheetTopY;
      const maxPeek = Math.min(480, Math.max(120, span - 48));
      const minPeek = 120;
      const next = Math.max(minPeek, Math.min(maxPeek, raw));
      setSheetPeekPx((prev) => (Math.abs(prev - next) < 3 ? prev : next));
    },
    [sheetAnchorBottomY, expandedSheetTopY]
  );

  const cancelSheetAnimation = useCallback(() => {
    if (sheetAnimRafRef.current != null) {
      cancelAnimationFrame(sheetAnimRafRef.current);
      sheetAnimRafRef.current = null;
    }
  }, []);

  const animateSheetTo = useCallback(
    (to: number) => {
      cancelSheetAnimation();
      const max = maxSheetTranslate;
      const clamped = Math.max(0, Math.min(max, to));
      const from = sheetTranslateRef.current;
      if (Math.abs(from - clamped) < 1) {
        sheetTranslateRef.current = clamped;
        setSheetTranslate(clamped);
        return;
      }
      const duration = 320;
      const t0 = Date.now();
      const tick = () => {
        const elapsed = Date.now() - t0;
        const t = Math.min(1, elapsed / duration);
        const eased = Easing.out(Easing.cubic)(t);
        const v = from + (clamped - from) * eased;
        sheetTranslateRef.current = v;
        setSheetTranslate(v);
        if (t < 1) {
          sheetAnimRafRef.current = requestAnimationFrame(tick);
        } else {
          sheetAnimRafRef.current = null;
          sheetTranslateRef.current = clamped;
          setSheetTranslate(clamped);
        }
      };
      sheetAnimRafRef.current = requestAnimationFrame(tick);
    },
    [cancelSheetAnimation, maxSheetTranslate]
  );

  useLayoutEffect(() => {
    cancelSheetAnimation();
    setSheetTranslate((t) => {
      const c = Math.min(t, maxSheetTranslate);
      sheetTranslateRef.current = c;
      return c;
    });
  }, [maxSheetTranslate, cancelSheetAnimation]);

  useEffect(() => () => cancelSheetAnimation(), [cancelSheetAnimation]);

  /** Stable padding for fitBounds so sheet drag does not retrigger camera. */
  const courseFitPadding = useMemo(
    (): ViewPadding => ({
      top: badgeBottomAbs ?? badgeBottomFallbackY,
      right: 72,
      bottom: Math.max(insets.bottom + sheetPeekPx + 24, 140),
      left: Math.max(insets.left, 12)
    }),
    [badgeBottomAbs, badgeBottomFallbackY, insets.bottom, insets.left, sheetPeekPx]
  );

  useEffect(() => {
    void getBasemapPreset().then(setBasemapPresetState);
  }, []);

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", updateChromeLayoutMetrics);
    return () => sub.remove();
  }, [updateChromeLayoutMetrics]);

  useEffect(() => {
    Animated.timing(layerSlideX, {
      toValue: layersOpen ? 0 : layerPanelWidth,
      duration: layersOpen ? 240 : 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [layerPanelWidth, layerSlideX, layersOpen]);

  useEffect(() => {
    if (layersOpen) {
      setFailedBasemapPreviews([]);
    }
  }, [layersOpen]);

  useEffect(() => {
    if (!roomId || !token) {
      setServerWorkspace(null);
      return;
    }
    const client = createApiClient({ baseUrl: s.baseUrl, accessToken: token });
    void client
      .getMapWorkspace(roomId)
      .then((res) => {
        setServerWorkspace(res.mapWorkspace);
      })
      .catch(() => {
        setServerWorkspace(null);
      });
  }, [roomId, token, s.baseUrl]);

  useFocusEffect(
    useCallback(() => {
      s.onSetProjectionPollEnabled(true);
      s.onFetchProjection();
      if (room?.id) {
        void s.onFetchRoomDetails(room.id);
      }
      return () => {
        s.onSetProjectionPollEnabled(false);
      };
    }, [s.onFetchProjection, s.onSetProjectionPollEnabled, s.onFetchRoomDetails, room?.id])
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
    if (!room?.course) {
      return null;
    }
    if (projection !== undefined) {
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
    }
    if (lastPing?.decision === "accepted") {
      return { latitude: lastPing.latitude, longitude: lastPing.longitude };
    }
    return null;
  }, [room?.course, projection, courseLine, lastPing]);

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
    const next = paddedLngLatBounds(courseLine, 0.14);
    setCourseBounds(next);
  }, [courseLine]);

  useEffect(() => {
    lastCourseFitKeyRef.current = null;
    setSelectedCheckpointId(null);
  }, [roomId]);

  const mapInitialCenter = useMemo((): [number, number] => {
    if (courseLine.length >= 1) {
      const mid = courseLine[Math.floor(courseLine.length / 2)]!;
      return [mid[0]!, mid[1]!];
    }
    return [-98.5795, 39.8283];
  }, [courseLine]);

  /** Viewport center/zoom for layer-picker previews (synced from map + snapshot when opening layers). */
  const [mapViewCenter, setMapViewCenter] = useState<[number, number]>([-98.5795, 39.8283]);
  const [mapViewZoom, setMapViewZoom] = useState(11);

  useEffect(() => {
    setMapViewCenter(mapInitialCenter);
  }, [mapInitialCenter]);

  useEffect(() => {
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        const cam = cameraRef.current;
        if (!cam) {
          return;
        }
        if (followRunner && athletePos) {
          cam.easeTo({
            center: [athletePos.longitude, athletePos.latitude],
            zoom: 15,
            duration: 0,
            easing: "linear"
          });
          return;
        }
        if (followRunner && courseBounds && !athletePos) {
          const key = `${roomId ?? ""}:${courseBounds.join(",")}`;
          if (lastCourseFitKeyRef.current === key) {
            return;
          }
          lastCourseFitKeyRef.current = key;
          cam.fitBounds(courseBounds, {
            padding: courseFitPadding,
            duration: 450,
            easing: "ease"
          });
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [followRunner, athletePos, courseBounds, roomId, courseFitPadding]);

  const stopLocatePulse = useCallback(() => {
    locatePulseLoopRef.current?.stop();
    locatePulseLoopRef.current = null;
    locatePulse.stopAnimation();
    locatePulse.setValue(1);
  }, [locatePulse]);

  useEffect(() => {
    if (userLocateVisual !== "locating") {
      stopLocatePulse();
      return;
    }
    locatePulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(locatePulse, {
          toValue: 1.18,
          duration: 550,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        }),
        Animated.timing(locatePulse, {
          toValue: 1,
          duration: 550,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        })
      ])
    );
    locatePulseLoopRef.current.start();
    return () => stopLocatePulse();
  }, [userLocateVisual, locatePulse, stopLocatePulse]);

  const onPressCenterOnUser = useCallback(() => {
    setUserLocateVisual("locating");
    void executeCenterOnUser(async (signal) => {
      setFollowRunner(false);
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        ({ status } = await Location.requestForegroundPermissionsAsync());
      }
      if (signal.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      if (status !== "granted") {
        Alert.alert(
          "Location access",
          "CrewCue needs location permission to move the map to where you are. You can turn it on in Settings.",
          [
            { text: "Not now", style: "cancel" },
            { text: "Open Settings", onPress: () => void Linking.openSettings() }
          ]
        );
        const err = new Error("Location permission not granted");
        err.name = "LocationPermissionDenied";
        throw err;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });
      if (signal.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      const { longitude, latitude } = pos.coords;
      cameraRef.current?.easeTo({
        center: [longitude, latitude],
        zoom: 15,
        duration: 500,
        easing: "ease"
      });
    })
      .then((result) => {
        if (result.status === "skipped") {
          return;
        }
        setUserLocateVisual("latched");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setUserLocateVisual("default");
        if (err instanceof Error && err.name === "LocationPermissionDenied") {
          return;
        }
        appNoticeBus.presentTransient({
          fingerprint: "map:center-user",
          catalogKey: "locationUnavailable"
        });
      });
  }, [executeCenterOnUser]);

  const locateIconColor = userLocateVisual === "default" ? theme.color.text : LOCATE_ACCENT;

  const onPressCenterOnRunner = useCallback(() => {
    setFollowRunner(true);
    if (!athletePos) {
      return;
    }
    cameraRef.current?.easeTo({
      center: [athletePos.longitude, athletePos.latitude],
      zoom: 15,
      duration: 400,
      easing: "ease"
    });
  }, [athletePos]);

  const onRegionDidChange = useCallback((e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const ev = e.nativeEvent;
    if (ev.center && ev.center.length >= 2) {
      const [lng, lat] = ev.center;
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        setMapViewCenter([lng, lat]);
      }
    }
    if (typeof ev.zoom === "number" && Number.isFinite(ev.zoom)) {
      setMapViewZoom(ev.zoom);
    }
    if (ev.userInteraction) {
      setFollowRunner(false);
    }
  }, []);

  const openLayersPanel = useCallback(async () => {
    try {
      const m = mapRef.current;
      if (m) {
        const c = await m.getCenter();
        const z = await m.getZoom();
        if (c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
          setMapViewCenter([c[0]!, c[1]!]);
        }
        if (Number.isFinite(z)) {
          setMapViewZoom(z);
        }
      }
    } catch {
      /* keep last region-derived values */
    }
    setLayersOpen(true);
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

  /** Prefer server-derived canonical length, then room course distance, then projection / last split cumulative. */
  const effectiveCourseLengthMeters = useMemo(() => {
    const canonical =
      room?.course &&
      typeof room.course.derivedMetrics?.canonicalDistanceMeters === "number" &&
      Number.isFinite(room.course.derivedMetrics.canonicalDistanceMeters) &&
      room.course.derivedMetrics.canonicalDistanceMeters > 0
        ? room.course.derivedMetrics.canonicalDistanceMeters
        : null;
    if (canonical != null) {
      return canonical;
    }
    const roomStored =
      typeof room?.courseDistanceMeters === "number" &&
      Number.isFinite(room.courseDistanceMeters) &&
      room.courseDistanceMeters > 0
        ? room.courseDistanceMeters
        : null;
    if (roomStored != null) {
      return roomStored;
    }
    if (projection && projection.courseLengthMeters > 0) {
      return projection.courseLengthMeters;
    }
    const splits = projection?.checkpointSplits ?? [];
    const last = splits[splits.length - 1];
    if (last && typeof last.distanceMetersFromStart === "number" && last.distanceMetersFromStart > 0) {
      return last.distanceMetersFromStart;
    }
    return null;
  }, [room?.course, room?.courseDistanceMeters, projection]);

  const mapSheetPhase = useMemo((): "preStart" | "finish" | "race" => {
    const anchorMs = parseRaceAnchorMs(scheduleRoom);
    if (anchorMs != null && Date.now() < anchorMs) {
      return "preStart";
    }
    const splits = projection?.checkpointSplits ?? [];
    const allCrossed = splits.length > 0 && splits.every((r) => r.crossedAtRecordedAt != null);
    const len = effectiveCourseLengthMeters;
    const courseLenFromProjection =
      projection != null && projection.courseLengthMeters > 40 ? projection.courseLengthMeters : null;
    const effectiveLen = len ?? courseLenFromProjection;
    const pastEnd =
      projection != null &&
      effectiveLen != null &&
      effectiveLen > 40 &&
      projection.progressMeters >= effectiveLen - 75;
    if (allCrossed || pastEnd) {
      return "finish";
    }
    return "race";
  }, [
    scheduleRoom?.raceStartAt,
    scheduleRoom?.activatedAt,
    projection?.checkpointSplits,
    projection?.progressMeters,
    effectiveCourseLengthMeters,
    projectionPolledAt
  ]);

  const remainingDistM = useMemo(() => {
    if (!projection) {
      return null;
    }
    const len = effectiveCourseLengthMeters ?? (projection.courseLengthMeters > 0 ? projection.courseLengthMeters : null);
    if (len == null || len <= 0) {
      return null;
    }
    return Math.max(0, len - projection.progressMeters);
  }, [projection, effectiveCourseLengthMeters]);

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
    const courseLen =
      effectiveCourseLengthMeters != null && effectiveCourseLengthMeters > 0
        ? effectiveCourseLengthMeters
        : projection.courseLengthMeters > 0
          ? projection.courseLengthMeters
          : sampleEnd;
    const ratio = courseLen > 0 ? sampleEnd / courseLen : 1;
    const dAlong = projection.progressMeters * ratio;
    return remainingGainAndLossMetersAfter(samples, dAlong);
  }, [projection, room, workspace, effectiveCourseLengthMeters]);

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

  const checkpointDistanceById = useMemo(() => {
    const map = new Map<string, number>();
    if (!room?.course) {
      return map;
    }
    const cps = room.course.checkpoints;
    for (const cp of cps) {
      if (typeof cp.distanceMetersFromStart === "number" && Number.isFinite(cp.distanceMetersFromStart)) {
        map.set(cp.id, cp.distanceMetersFromStart);
      }
    }
    if (map.size === cps.length) {
      return map;
    }
    const projectionRows = projection?.checkpointSplits ?? [];
    for (const row of projectionRows) {
      if (
        !map.has(row.checkpointId) &&
        typeof row.distanceMetersFromStart === "number" &&
        Number.isFinite(row.distanceMetersFromStart)
      ) {
        map.set(row.checkpointId, row.distanceMetersFromStart);
      }
    }
    if (map.size === cps.length) {
      return map;
    }
    const fallback = buildExpectedAidStationSplitsFromCourse(
      room.course,
      projection?.plannedPaceSecondsPerKm ?? room.plannedPaceSecondsPerKm ?? 360,
      "mi"
    ).splits;
    for (let index = 0; index < fallback.length; index += 1) {
      const checkpointId = room.course.checkpoints[index]?.id;
      if (!checkpointId || map.has(checkpointId)) {
        continue;
      }
      map.set(checkpointId, fallback[index]!.distanceKm * 1000);
    }
    return map;
  }, [room?.course, room?.plannedPaceSecondsPerKm, projection?.checkpointSplits, projection?.plannedPaceSecondsPerKm]);

  const resolvedNextCheckpoint = useMemo(
    () => resolveNextCheckpointForMapSheet(room, projection, checkpointDistanceById),
    [room, projection, checkpointDistanceById]
  );

  const nextCheckpointLabel = useMemo(() => {
    if (!resolvedNextCheckpoint || !room) {
      return "—";
    }
    return checkpointLabel(room, resolvedNextCheckpoint.checkpointId);
  }, [resolvedNextCheckpoint, room]);

  const selectedCheckpointTooltip = useMemo(() => {
    if (!selectedCheckpointId) {
      return null;
    }
    const label = checkpointLabel(room, selectedCheckpointId);
    const checkpointIndex = room?.course?.checkpoints?.findIndex((cp) => cp.id === selectedCheckpointId) ?? -1;
    if (checkpointIndex === 0) {
      return { label, etaText: "Start checkpoint" };
    }
    const distanceFromStart = checkpointDistanceById.get(selectedCheckpointId);
    const pace = projection?.plannedPaceSecondsPerKm ?? room?.plannedPaceSecondsPerKm;
    if (distanceFromStart === undefined || !pace || !Number.isFinite(pace) || pace <= 0) {
      return { label, etaText: "ETA unavailable" };
    }
    const progressMeters = projection?.progressMeters ?? 0;
    const secondsToCheckpoint = secondsForDistance(Math.max(0, distanceFromStart - progressMeters), pace);
    return {
      label,
      etaText: `${formatEtaClock(Date.now() + secondsToCheckpoint * 1000)} (${formatRemainingMinutes(secondsToCheckpoint)})`
    };
  }, [selectedCheckpointId, room, checkpointDistanceById, projection?.plannedPaceSecondsPerKm, projection?.progressMeters]);

  const etaNextLabel = useMemo(() => {
    if (mapSheetPhase !== "race") {
      return { time: "—", remain: "—" };
    }
    if (!projection || !resolvedNextCheckpoint) {
      return { time: "—", remain: "—" };
    }
    const pace = projection.plannedPaceSecondsPerKm ?? room?.plannedPaceSecondsPerKm;
    if (!pace || !Number.isFinite(pace) || pace <= 0) {
      return { time: "—", remain: "—" };
    }
    const distToNext = Math.max(0, resolvedNextCheckpoint.distanceMetersFromStart - projection.progressMeters);
    const secondsToNext = secondsForDistance(distToNext, pace);
    const etaMs = Date.now() + secondsToNext * 1000;
    return { time: formatEtaClock(etaMs), remain: formatRemainingMinutes(secondsToNext) };
  }, [mapSheetPhase, projection, resolvedNextCheckpoint, room?.plannedPaceSecondsPerKm]);

  const preStartSheetDetails = useMemo(() => {
    if (mapSheetPhase !== "preStart") {
      return null;
    }
    const anchorMs = parseRaceAnchorMs(scheduleRoom);
    if (anchorMs == null) {
      return null;
    }
    const startsInSec = Math.max(0, (anchorMs - Date.now()) / 1000);
    return {
      startsAtLine: new Date(anchorMs).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }),
      startsAtTimeOfDay: new Date(anchorMs).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      }),
      startsInRemain: startsInSec >= 60 ? formatRemainingMinutes(startsInSec) : startsInSec > 0 ? "< 1 min" : "Starting",
      startsAtClock: formatEtaClock(anchorMs)
    };
  }, [mapSheetPhase, scheduleRoom?.raceStartAt, scheduleRoom?.activatedAt, projectionPolledAt]);

  const finishSheetDetails = useMemo(() => {
    if (mapSheetPhase !== "finish" || !room?.course?.checkpoints?.length) {
      return null;
    }
    const cps = room.course.checkpoints;
    const lastCp = cps[cps.length - 1]!;
    const splits = projection?.checkpointSplits ?? [];
    const lastSplit = splits.length > 0 ? splits[splits.length - 1] : undefined;
    const crossedIso = lastSplit?.crossedAtRecordedAt ?? projection?.asOfRecordedAt ?? null;
    const anchorMs = parseRaceAnchorMs(scheduleRoom);
    let wallClockStr = "—";
    let totalElapsedStr = "—";
    if (crossedIso) {
      const crossedMs = Date.parse(crossedIso);
      if (Number.isFinite(crossedMs)) {
        wallClockStr = new Date(crossedMs).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit"
        });
        const elapsedSec =
          lastSplit?.actualElapsedSecondsAtCross != null && Number.isFinite(lastSplit.actualElapsedSecondsAtCross)
            ? lastSplit.actualElapsedSecondsAtCross
            : anchorMs != null
              ? Math.max(0, (crossedMs - anchorMs) / 1000)
              : Number.NaN;
        totalElapsedStr = Number.isFinite(elapsedSec) ? formatElapsedHoursMinutes(elapsedSec) : "—";
      }
    }
    const locationLine = `${checkpointLabel(room, lastCp.id)} · ${lastCp.latitude.toFixed(4)}°, ${lastCp.longitude.toFixed(4)}°`;
    return { wallClockStr, totalElapsedStr, locationLine, stationTitle: checkpointLabel(room, lastCp.id) };
  }, [mapSheetPhase, room, projection?.checkpointSplits, projection?.asOfRecordedAt, scheduleRoom?.raceStartAt, scheduleRoom?.activatedAt]);

  const runnerLocationCaption = useMemo(() => {
    if (!room) {
      return null;
    }
    if (projection && room.course) {
      const mi = projection.progressMeters / 1609.344;
      return `Runner ~${mi.toFixed(1)} mi along course`;
    }
    if (lastPing?.decision === "accepted") {
      const t = Date.parse(lastPing.recordedAt);
      const clock = Number.isFinite(t) ? formatEtaClock(t) : "";
      return `Last ping${clock ? ` ${clock}` : ""} · ${lastPing.latitude.toFixed(3)}°, ${lastPing.longitude.toFixed(3)}°`;
    }
    return "Waiting for runner location…";
  }, [room, projection, lastPing]);

  const onTrackLabel = projection?.projectionConfidence === "fresh" ? "ON TRACK" : "DEGRADED";

  const pickBasemap = async (preset: BasemapPresetId) => {
    setBasemapPresetState(preset);
    await setBasemapPreset(preset);
    setLayersOpen(false);
  };

  const layerPreviewSize = useMemo(() => {
    const w = Math.max(88, layerPanelWidth - 32);
    const h = Math.round((w * 9) / 16);
    return { w, h };
  }, [layerPanelWidth]);

  /** Snap to fully expanded (`0`) or peek (`maxSheetTranslate`) after drag. */
  const snapSheet = useCallback(
    (y: number, vy: number) => {
      const max = maxSheetTranslate;
      const mid = max / 2;
      let target: number;
      if (Math.abs(vy) > 0.65) {
        target = vy > 0 ? max : 0;
      } else {
        target = y < mid ? 0 : max;
      }
      animateSheetTo(target);
    },
    [maxSheetTranslate, animateSheetTo]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          cancelSheetAnimation();
          sheetDragStart.current = sheetTranslateRef.current;
        },
        onPanResponderMove: (_, g) => {
          const next = Math.max(0, Math.min(maxSheetTranslate, sheetDragStart.current + g.dy));
          sheetTranslateRef.current = next;
          setSheetTranslate(next);
        },
        onPanResponderRelease: (_, g) => {
          const next = Math.max(0, Math.min(maxSheetTranslate, sheetDragStart.current + g.dy));
          snapSheet(next + g.vy * 0.08, g.vy);
        }
      }),
    [maxSheetTranslate, snapSheet, cancelSheetAnimation]
  );

  const cycleSheet = () => {
    const max = maxSheetTranslate;
    const cur = sheetTranslateRef.current;
    animateSheetTo(cur > max / 2 ? 0 : max);
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
        settingsHit: {
          paddingVertical: 6,
          paddingHorizontal: 4,
          justifyContent: "center",
          alignItems: "center"
        },
        raceTitlePill: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 999,
          backgroundColor: activeMode === "light" ? "rgba(255, 255, 255, 0.94)" : "rgba(28, 30, 36, 0.88)",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.color.border,
          maxWidth: WINDOW.width * 0.7
        },
        raceTitleText: { color: theme.color.text, fontSize: 17, fontWeight: "800" },
        raceTitleChevron: { color: theme.color.muted, fontSize: 12, fontWeight: "800" },
        badgeRow: {
          position: "absolute",
          top: insets.top + HEADER_INNER + BADGE_ROW_GAP_BELOW_HEADER,
          left: 12,
          right: 12,
          flexDirection: "row",
          justifyContent: "space-between",
          zIndex: 19
        },
        badgePill: {
          backgroundColor: activeMode === "light" ? "rgba(255, 255, 255, 0.94)" : "rgba(28, 30, 36, 0.9)",
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 999,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.color.border,
          maxWidth: WINDOW.width * 0.48
        },
        badgePillMuted: {
          backgroundColor: activeMode === "light" ? "rgba(255, 255, 255, 0.88)" : "rgba(28, 30, 36, 0.82)"
        },
        badgePillText: { color: theme.color.text, fontWeight: "700", fontSize: 11 },
        checkpointTooltip: {
          position: "absolute",
          left: 12,
          right: 12,
          top: insets.top + HEADER_INNER + BADGE_ROW_GAP_BELOW_HEADER + 42,
          backgroundColor: theme.color.card,
          borderRadius: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.color.border,
          paddingHorizontal: 12,
          paddingVertical: 10,
          zIndex: 21
        },
        checkpointTooltipTitle: { color: theme.color.text, fontSize: 14, fontWeight: "800", paddingRight: 20 },
        checkpointTooltipBody: { color: theme.color.muted, fontSize: 12, marginTop: 3, paddingRight: 20 },
        checkpointTooltipClose: {
          position: "absolute",
          right: 4,
          top: 4,
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center"
        },
        checkpointMarkerTouch: {
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "transparent"
        },
        checkpointMarkerDot: {
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: activeMode === "light" ? "rgba(234, 88, 12, 0.98)" : "rgba(251, 146, 60, 0.95)",
          borderWidth: 2,
          borderColor: activeMode === "light" ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 23, 42, 0.9)"
        },
        fabCol: {
          position: "absolute",
          right: 14,
          bottom: insets.bottom + (SHEET_H - sheetTranslate) + 16,
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
          transform: [{ translateY: sheetTranslate }],
          flexDirection: "column"
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
        checklistTitle: { marginTop: 4, fontWeight: "700", color: theme.color.text },
        checklistRow: {
          marginTop: 10,
          paddingBottom: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.color.divider
        },
        sheetKicker: { fontSize: 11, fontWeight: "700", color: theme.color.muted },
        etaPill: {
          marginTop: 6,
          backgroundColor: theme.color.secondaryButton,
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 999,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.color.border
        },
        etaPillText: { color: theme.color.text, fontWeight: "800", fontSize: 12 },
        layerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0, 0, 0, 0.4)" },
        layerPanel: {
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          borderTopLeftRadius: 16,
          borderBottomLeftRadius: 16,
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowRadius: 12,
          shadowOffset: { width: -4, height: 0 },
          elevation: 8
        },
        layerHeaderRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          marginBottom: 8
        },
        layerOptionRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.color.divider
        },
        layerPreviewFrame: {
          borderRadius: 10,
          overflow: "hidden",
          backgroundColor: theme.color.secondaryButton,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.color.border,
          position: "relative"
        },
        layerPreviewOverlay: {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingVertical: 8,
          paddingHorizontal: 10,
          backgroundColor: "rgba(0, 0, 0, 0.62)"
        },
        layerPreviewTitle: {
          color: "#ffffff",
          fontSize: 15,
          fontWeight: "800",
          textShadowColor: "rgba(0,0,0,0.45)",
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 2
        },
        layerPreviewPlaceholder: {
          ...StyleSheet.absoluteFillObject,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.color.secondaryButton
        },
        layerSubtitle: { color: theme.color.muted, fontSize: 13, lineHeight: 18 }
      }),
    [activeMode, insets.top, insets.bottom, SHEET_H, sheetPeekPx, sheetTranslate, theme]
  );

  const sheetExpandProgress =
    maxSheetTranslate > 0
      ? Math.min(1, Math.max(0, (maxSheetTranslate - sheetTranslate) / maxSheetTranslate))
      : 0;
  const fabOpacity = 1 - sheetExpandProgress;

  if (!inRace) {
    return (
      <ScrollView style={s.styles.container} contentContainerStyle={[s.styles.scroll, styles.emptyWrap]}>
        <View style={{ marginBottom: 12 }}>
          <Text style={s.styles.title}>CrewCue</Text>
          <Text style={s.styles.subtitle}>
            Open settings to create or edit a race, join a room, or manage your workspace.
          </Text>
        </View>
        <DSButton preset="primary" onPress={() => navigation.navigate("WorkspaceMenu")}>
          Open settings
        </DSButton>
      </ScrollView>
    );
  }

  return (
    <View ref={rootRef} style={styles.root} onLayout={updateChromeLayoutMetrics}>
      <MapLibreMap
        ref={mapRef}
        key={`dash-${basemapPreset}`}
        style={styles.map}
        mapStyle={mobileMapStyleUrlForPreset(basemapPreset)}
        onRegionDidChange={onRegionDidChange}
        onDidFailLoadingMap={onMapDidFailLoading}
      >
        <Camera ref={cameraRef} initialViewState={{ center: mapInitialCenter, zoom: 11 }} />
        {routeFeature ? (
          <GeoJSONSource id="dash-route" data={routeFeature}>
            <Layer
              id="dash-route-line"
              type="line"
              style={{
                lineColor: "#ea580c",
                lineWidth: 5,
                lineOpacity: 0.95
              }}
            />
          </GeoJSONSource>
        ) : null}
        {athleteFeature ? (
          <GeoJSONSource id="dash-athlete" data={athleteFeature}>
            <Layer
              id="dash-athlete-circle"
              type="circle"
              style={{
                circleRadius: 10,
                circleColor: activeMode === "light" ? "rgba(37, 99, 235, 0.95)" : "rgba(147, 197, 253, 0.95)",
                circleStrokeWidth: 3,
                circleStrokeColor: activeMode === "light" ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 23, 42, 0.9)"
              }}
            />
          </GeoJSONSource>
        ) : null}
        {(room?.course?.checkpoints ?? []).map((checkpoint, index) => (
          <Marker
            key={`dash-checkpoint-marker-${checkpoint.id}-${index}`}
            id={`dash-checkpoint-marker-${checkpoint.id}-${index}`}
            lngLat={[checkpoint.longitude, checkpoint.latitude]}
            onPress={() => setSelectedCheckpointId(checkpoint.id)}
          >
            <View style={styles.checkpointMarkerTouch}>
              <View style={styles.checkpointMarkerDot} />
            </View>
          </Marker>
        ))}
      </MapLibreMap>

      <View style={styles.header} pointerEvents="box-none">
        <View style={{ width: 40 }} />
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
            style={styles.raceTitlePill}
          >
            <Text style={styles.raceTitleText} numberOfLines={1}>
              {selectedRace?.name?.trim() ? selectedRace.name : "CrewCue"}
            </Text>
            <Text style={styles.raceTitleChevron}>{showRaceSelectorModal ? "▲" : "▼"}</Text>
          </Pressable>
        </View>
        <Pressable
          onPress={() => navigation.navigate("WorkspaceMenu")}
          style={styles.settingsHit}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Workspace menu"
        >
          <Ionicons name="settings-outline" size={28} color="#4b5563" />
        </Pressable>
      </View>

      <View ref={badgeRowRef} style={styles.badgeRow} onLayout={updateChromeLayoutMetrics} pointerEvents="none">
        <View style={styles.badgePill}>
          <Text style={styles.badgePillText}>{onTrackLabel}</Text>
        </View>
        <View style={[styles.badgePill, styles.badgePillMuted]}>
          <Text style={styles.badgePillText}>
            ● LAST PING: {formatPingAgo(projection?.secondsSinceLastAcceptedPing)}
          </Text>
        </View>
      </View>

      {selectedCheckpointTooltip ? (
        <View style={styles.checkpointTooltip}>
          <Text style={styles.checkpointTooltipTitle}>{selectedCheckpointTooltip.label}</Text>
          <Text style={styles.checkpointTooltipBody}>ETA {selectedCheckpointTooltip.etaText}</Text>
          <Pressable onPress={() => setSelectedCheckpointId(null)} style={styles.checkpointTooltipClose}>
            <Ionicons name="close" size={20} color={theme.color.text} />
          </Pressable>
        </View>
      ) : null}

      <View
        style={[styles.fabCol, { opacity: fabOpacity }]}
        pointerEvents={sheetExpandProgress >= 0.995 ? "none" : "box-none"}
      >
        <Pressable
          style={styles.fab}
          onPress={() => void onPressCenterOnUser()}
          accessibilityLabel="Center map on your location"
          accessibilityState={{ busy: userLocateVisual === "locating" }}
        >
          <Animated.View style={{ transform: [{ scale: locatePulse }] }}>
            <Ionicons name="locate" size={22} color={locateIconColor} />
          </Animated.View>
        </Pressable>
        <Pressable style={styles.fab} onPress={onPressCenterOnRunner} accessibilityLabel="Center map on runner">
          <Image
            source={require("../../assets/onboarding/crew-cue-onboarding-runner.png")}
            style={{ width: 36, height: 36, borderRadius: 18 }}
          />
        </Pressable>
        <Pressable style={styles.fab} onPress={() => void openLayersPanel()} accessibilityLabel="Map layers">
          <Ionicons name="layers-outline" size={22} color={theme.color.text} />
        </Pressable>
      </View>

      <View style={styles.sheet}>
        <View {...panResponder.panHandlers}>
          <Pressable onPress={cycleSheet} accessibilityRole="button" accessibilityLabel="Expand sheet">
            <View style={styles.handle} />
          </Pressable>
        </View>
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 4,
            paddingBottom: insets.bottom + 10,
            flexShrink: 0,
            borderBottomWidth: hideChecklistInPeek ? 0 : StyleSheet.hairlineWidth,
            borderBottomColor: theme.color.divider
          }}
          onLayout={onSheetPeekSectionLayout}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              {mapSheetPhase === "preStart" ? (
                <>
                  <Text style={styles.sheetKicker}>RACE START</Text>
                  <Text style={{ color: theme.color.text, fontSize: 20, fontWeight: "800", marginTop: 4 }}>
                    {startCheckpointTitle}
                  </Text>
                  <Text style={{ color: theme.color.muted, fontSize: 14, fontWeight: "600", marginTop: 6 }}>
                    {preStartSheetDetails?.startsAtLine ?? "Set a race start time in Race setup."}
                  </Text>
                </>
              ) : mapSheetPhase === "finish" ? (
                <>
                  <Text style={styles.sheetKicker}>FINISHED</Text>
                  <Text style={{ color: theme.color.text, fontSize: 20, fontWeight: "800", marginTop: 4 }}>
                    {finishSheetDetails?.stationTitle ?? nextCheckpointLabel}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.sheetKicker}>NEXT AID STATION</Text>
                  <Text style={{ color: theme.color.text, fontSize: 20, fontWeight: "800", marginTop: 4 }}>
                    {nextCheckpointLabel}
                  </Text>
                </>
              )}
            </View>
            <View style={{ alignItems: "flex-end" }}>
              {mapSheetPhase === "preStart" ? (
                <>
                  <Text style={{ color: theme.color.text, fontSize: 22, fontWeight: "800" }}>
                    {preStartSheetDetails?.startsAtTimeOfDay ?? preStartSheetDetails?.startsAtClock ?? "—"}
                  </Text>
                  <Text style={{ color: theme.color.muted, fontSize: 11, marginTop: 2 }}>START TIME</Text>
                  <View style={styles.etaPill}>
                    <Text style={styles.etaPillText}>{preStartSheetDetails?.startsInRemain ?? "—"}</Text>
                  </View>
                  <Text style={{ color: theme.color.muted, fontSize: 10, marginTop: 4 }}>UNTIL START</Text>
                </>
              ) : mapSheetPhase === "finish" ? (
                <>
                  <Text style={{ color: theme.color.text, fontSize: 22, fontWeight: "800" }}>
                    {finishSheetDetails?.wallClockStr ?? "—"}
                  </Text>
                  <Text style={{ color: theme.color.muted, fontSize: 11, marginTop: 2 }}>LOCAL TIME</Text>
                  <View style={styles.etaPill}>
                    <Text style={styles.etaPillText}>{finishSheetDetails?.totalElapsedStr ?? "—"}</Text>
                  </View>
                  <Text style={{ color: theme.color.muted, fontSize: 10, marginTop: 4 }}>TOTAL ELAPSED</Text>
                </>
              ) : (
                <>
                  <Text style={{ color: theme.color.text, fontSize: 22, fontWeight: "800" }}>{etaNextLabel.time}</Text>
                  <Text style={{ color: theme.color.muted, fontSize: 11, marginTop: 2 }}>EST. ARRIVAL</Text>
                  <View style={styles.etaPill}>
                    <Text style={styles.etaPillText}>{etaNextLabel.remain}</Text>
                  </View>
                </>
              )}
            </View>
          </View>
          {runnerLocationCaption ? (
            <Text style={{ color: theme.color.muted, fontSize: 13, marginTop: 10 }}>{runnerLocationCaption}</Text>
          ) : null}
          {mapSheetPhase === "finish" && finishSheetDetails ? (
            <Text style={{ color: theme.color.muted, fontSize: 13, marginTop: 6 }}>{finishSheetDetails.locationLine}</Text>
          ) : null}

          {mapSheetPhase === "race" ? (
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
          ) : null}
        </View>
        <ScrollView
          style={{
            flex: hideChecklistInPeek ? 0 : 1,
            maxHeight: hideChecklistInPeek ? 0 : undefined,
            opacity: hideChecklistInPeek ? 0 : 1,
            paddingHorizontal: 16
          }}
          contentContainerStyle={{ paddingBottom: 16 + insets.bottom }}
          scrollEnabled={!hideChecklistInPeek && sheetTranslate < maxSheetTranslate - 2}
          pointerEvents={hideChecklistInPeek ? "none" : "auto"}
        >
          <Text style={styles.checklistTitle}>Aid station checklist</Text>
          {(projection?.checkpointSplits ?? []).map((row, index) => {
            const label = checkpointLabel(room, row.checkpointId);
            const crossed = row.crossedAtRecordedAt ? new Date(row.crossedAtRecordedAt).toLocaleTimeString() : "Pending";
            return (
              <View key={`${row.checkpointId}-${index}`} style={styles.checklistRow}>
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
        </ScrollView>
      </View>

      <Modal visible={layersOpen} transparent animationType="fade" onRequestClose={() => setLayersOpen(false)}>
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable style={styles.layerBackdrop} onPress={() => setLayersOpen(false)} />
          <Animated.View
            style={[
              styles.layerPanel,
              {
                width: layerPanelWidth,
                backgroundColor: theme.color.card,
                paddingTop: insets.top + 12,
                paddingBottom: insets.bottom + 16,
                transform: [{ translateX: layerSlideX }]
              }
            ]}
          >
            <View style={styles.layerHeaderRow}>
              <Text style={{ fontWeight: "800", color: theme.color.text, fontSize: 18 }}>Map Layers</Text>
              <Pressable
                onPress={() => setLayersOpen(false)}
                hitSlop={14}
                accessibilityRole="button"
                accessibilityLabel="Close map layers"
              >
                <Ionicons name="close" size={28} color={theme.color.text} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {(["outdoor", "streets", "satellite"] as const).map((p) => {
                const layout = basemapPreviewLayout(
                  p,
                  mapViewCenter[0]!,
                  mapViewCenter[1]!,
                  mapViewZoom,
                  PixelRatio.get()
                );
                const label = `${p[0]!.toUpperCase()}${p.slice(1)}`;
                const subtitle =
                  p === "outdoor" ? "Terrain and trails" : p === "streets" ? "Roads and labels" : "Aerial imagery";
                const showPreview = Boolean(layout) && !failedBasemapPreviews.includes(p);
                const W = layerPreviewSize.w;
                const H = layerPreviewSize.h;
                const imgFrame = layout ? basemapPreviewImageFrame(W, H, layout) : null;
                return (
                  <Pressable key={p} onPress={() => void pickBasemap(p)} style={styles.layerOptionRow}>
                    <View
                      style={[
                        styles.layerPreviewFrame,
                        { width: layerPreviewSize.w, height: layerPreviewSize.h }
                      ]}
                    >
                      {showPreview && layout && imgFrame ? (
                        <Image
                          key={`${p}-${mapViewCenter[0]}-${mapViewCenter[1]}-${mapViewZoom}-${layout.intrinsicSize}`}
                          source={{ uri: layout.uri }}
                          style={{
                            position: "absolute",
                            width: imgFrame.width,
                            height: imgFrame.height,
                            left: imgFrame.left,
                            top: imgFrame.top
                          }}
                          onError={() => setFailedBasemapPreviews((prev) => (prev.includes(p) ? prev : [...prev, p]))}
                        />
                      ) : (
                        <View style={styles.layerPreviewPlaceholder}>
                          <Text style={{ color: theme.color.muted, fontSize: 11, fontWeight: "600" }}>
                            {layout ? "Could not load preview" : "Add MapTiler key for previews"}
                          </Text>
                        </View>
                      )}
                      <View style={styles.layerPreviewOverlay} pointerEvents="none">
                        <Text style={styles.layerPreviewTitle}>{label}</Text>
                      </View>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
                      <Text style={styles.layerSubtitle}>{subtitle}</Text>
                      {basemapPreset === p ? (
                        <Text style={{ marginTop: 8, fontWeight: "700", color: theme.color.text, fontSize: 12 }}>
                          Selected ✓
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
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
