import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Dimensions, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DSButton, DSCard, useDSTheme } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import { RacePickerOverlay } from "./RacePickerOverlay";
import { TOOLTIP_SHEET_SEAM_OVERLAP } from "./racePickerLayoutConstants";
import type { OperateStackParamList } from "./types";

const WINDOW = Dimensions.get("window");
const RACE_PICKER_WIDTH_RATIO = 0.92;
/** Native-stack header content height (below status bar / notch). */
const STACK_HEADER_BAR = Platform.select({ ios: 44, default: 56 });
/** Fixed “Switch race” block inside the card (not scrolled). */
const RACE_CARD_TOP_BLOCK = 76;
/** Close row + top border + padding inside the card. */
const RACE_CARD_FOOTER_BLOCK = 58;
/** Vertical padding inside the tooltip card (top + bottom). */
const RACE_CARD_INNER_PADDING_V = 18;

type WindowRect = { x: number; y: number; width: number; height: number };

const racePickerChrome = StyleSheet.create({
  /** Keep title layout stable and unboxed. */
  titleCapsule: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center"
  }
});

export function AuthenticatedOperateScreen(): ReactElement {
  const s = useAuthedShell();
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<OperateStackParamList, "OperateHome">>();
  const inRace = Boolean(s.room);
  const [showRaceSelectorModal, setShowRaceSelectorModal] = useState(false);
  const [raceTitleRect, setRaceTitleRect] = useState<WindowRect | null>(null);
  const raceTitleRef = useRef<View>(null);
  const raceSelectorMaxHeight = WINDOW.height * 0.5;
  const headerBottomY = insets.top + STACK_HEADER_BAR;
  const raceSelectorScrollMaxHeight = Math.max(
    120,
    raceSelectorMaxHeight - RACE_CARD_INNER_PADDING_V - RACE_CARD_TOP_BLOCK - RACE_CARD_FOOTER_BLOCK
  );

  useEffect(() => {
    if (!inRace || !s.room) {
      return;
    }
    void s.onFetchRoomDetails(s.room.id);
    void s.onFetchInvites();
  }, [inRace, s.room?.id]);

  const selectedRace = s.room;
  /** Keep active room visible even if /mine briefly omits it. */
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
    const withoutSelected = all.filter((room) => room.id !== selectedRace?.id);
    const current: typeof withoutSelected = [];
    const upcoming: typeof withoutSelected = [];
    const past: typeof withoutSelected = [];
    for (const room of withoutSelected) {
      const endMs = room.eventEndsAt ? Date.parse(room.eventEndsAt) : undefined;
      if (room.status === "active" && (endMs === undefined || endMs >= now)) {
        current.push(room);
      } else if (endMs !== undefined && endMs < now) {
        past.push(room);
      } else {
        upcoming.push(room);
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

  const membershipLabel = (userId: string): string => {
    const member = s.room?.memberships.find((m) => m.userId === userId);
    const fromRoster = member?.displayName?.trim();
    if (fromRoster) {
      return fromRoster;
    }
    if (s.room?.athleteId === userId) {
      return s.room.creatorName?.trim() || s.raceProfile?.creatorName?.trim() || userId;
    }
    if (userId === s.auth.claims?.sub) {
      const ownName = s.auth.claims?.email?.split("@")[0]?.replace(/[._-]+/g, " ").trim();
      if (ownName) {
        return toTitleCaseRoster(ownName);
      }
      return "You";
    }
    return userId;
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitleAlign: "center",
      headerTitle: () => (
        <View
          ref={raceTitleRef}
          collapsable={false}
          onLayout={() => {
            if (showRaceSelectorModal) {
              syncRaceTitleRect();
            }
          }}
          style={racePickerChrome.titleCapsule}
        >
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
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingHorizontal: 4,
              paddingVertical: 2,
              width: "100%"
            }}
          >
            <Text style={{ color: theme.color.authHeading, fontSize: 18, fontWeight: "700" }}>
              {selectedRace?.name?.trim() ? selectedRace.name : "Operate"}
            </Text>
            <Text style={{ color: theme.color.authAccent, fontSize: 14, fontWeight: "800" }}>
              {showRaceSelectorModal ? "▲" : "▼"}
            </Text>
          </Pressable>
        </View>
      )
    });
  }, [navigation, s, selectedRace?.name, showRaceSelectorModal, syncRaceTitleRect, theme.color.authAccent, theme.color.authHeading]);

  const courseDistanceLabel = useMemo(() => {
    const points = s.room?.course?.baselineTrack?.points;
    const meters = s.room?.courseDistanceMeters ?? points?.[points.length - 1]?.distanceMetersFromStart;
    if (typeof meters !== "number" || !Number.isFinite(meters) || meters <= 0) {
      return "Not available";
    }
    const miles = meters / 1609.344;
    return `${miles.toFixed(1)} mi`;
  }, [s.room?.course?.baselineTrack?.points, s.room?.courseDistanceMeters]);
  const courseVertLabel = useMemo(() => {
    const meters = s.room?.courseElevationGainMeters;
    if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) {
      return "Not available";
    }
    const feet = Math.round(meters * 3.28084);
    return `${feet.toLocaleString()} ft gain`;
  }, [s.room?.courseElevationGainMeters]);

  const racePanelLayout = useMemo(() => {
    const panelW = WINDOW.width * RACE_PICKER_WIDTH_RATIO;
    return {
      left: Math.round((WINDOW.width - panelW) / 2),
      width: Math.round(panelW),
      top: headerBottomY - TOOLTIP_SHEET_SEAM_OVERLAP
    };
  }, [headerBottomY]);

  return (
    <ScrollView
      style={s.styles.container}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>CrewCue</Text>
        <Text style={s.styles.subtitle}>Race operations control center</Text>
        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>{inRace ? "You are in your race" : "Start your race setup"}</Text>
          <Text style={s.styles.body}>
            {inRace
              ? "Review race details, update your route, and share the crew link so everyone sees the same plan."
              : "Set up race details, optionally upload GPX, and share your crew link from one planning flow."}
          </Text>
        </DSCard>

        <DSCard style={[s.styles.summaryCard, { marginTop: 12 }]}>
          <Text style={s.styles.summaryTitle}>Race details</Text>
          {inRace ? (
            <>
              <Text style={s.styles.body}>
                Race name: {s.room?.name?.trim() || s.raceProfile?.raceName || "—"}
              </Text>
              <Text style={s.styles.body}>
                Crew name: {s.room?.crewName?.trim() || s.raceProfile?.crewName?.trim() || "Not set"}
              </Text>
              <Text style={s.styles.body}>
                Description: {s.room?.description?.trim() || s.raceProfile?.raceDescription?.trim() || "Not set"}
              </Text>
              <Text style={s.styles.body}>Course uploaded: {s.room?.course ? "Yes" : "No"}</Text>
              <Text style={s.styles.body}>Course distance: {courseDistanceLabel}</Text>
              <Text style={s.styles.body}>Course vert: {courseVertLabel}</Text>
              {s.room?.memberships.length ? (
                <Text style={s.styles.body}>
                  Crew members:{" "}
                  {s.room.memberships.map((member) => membershipLabel(member.userId)).join(", ")}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={s.styles.body}>
              You are not in a race yet. Tap Race setup to create your race and optional setup details.
            </Text>
          )}
          <View style={{ marginTop: 12, flexDirection: "column", gap: 8 }}>
            <DSButton
              preset="primary"
              onPress={() => navigation.navigate("RacePlanning", { mode: inRace ? "edit" : "create" })}
            >
              {inRace ? "Update race setup" : "Race setup"}
            </DSButton>
            {inRace ? (
              <>
                <DSButton preset="secondary" onPress={() => navigation.navigate("MapWorkspace")}>
                  Map workspace
                </DSButton>
                <DSButton preset="secondary" onPress={() => navigation.navigate("Navigate")}>
                  Navigate
                </DSButton>
              </>
            ) : null}
          </View>
        </DSCard>

        {!inRace ? (
          <DSCard style={[s.styles.summaryCard, { marginTop: 12 }]}>
            <Text style={s.styles.summaryTitle}>Join and member management moved to Menu</Text>
            <Text style={s.styles.body}>
              Open the top-right Menu from any screen to join a race room and manage team members.
            </Text>
          </DSCard>
        ) : null}

      </DSCard>
      <RacePickerOverlay
        visible={showRaceSelectorModal}
        panelLayout={racePanelLayout}
        titleHitRect={raceTitleRect}
        maxSheetHeight={raceSelectorMaxHeight}
        scrollMaxHeight={raceSelectorScrollMaxHeight}
        selectedRace={selectedRace}
        buckets={raceBuckets}
        onClose={() => setShowRaceSelectorModal(false)}
        onSelectRoom={(room) => {
          void s.onSelectRaceRoom(room);
          setShowRaceSelectorModal(false);
        }}
      />
    </ScrollView>
  );
}

function toTitleCaseRoster(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
