import { useEffect, useLayoutEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Modal, Pressable, ScrollView, Share, Text, View } from "react-native";
import { DSButton, DSCard, DSTextInput } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { OperateStackParamList } from "./types";

export function AuthenticatedOperateScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<NativeStackNavigationProp<OperateStackParamList, "OperateHome">>();
  const inRace = Boolean(s.room);
  const [joinCode, setJoinCode] = useState("");
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [showRaceSelectorModal, setShowRaceSelectorModal] = useState(false);

  useEffect(() => {
    if (!inRace || !s.room) {
      return;
    }
    void s.onFetchRoomDetails(s.room.id);
    void s.onFetchInvites();
  }, [inRace, s.room?.id]);

  const canIssueInvite = useMemo(() => {
    if (s.roomDetail?.permissions?.canIssueInvite) {
      return true;
    }
    const myUserId = s.auth.claims?.sub;
    if (!myUserId || !s.room) {
      return false;
    }
    const myMembership = s.room.memberships.find((member) => member.userId === myUserId);
    if (!myMembership) {
      return false;
    }
    return (
      myMembership.role === "athlete" ||
      myMembership.role === "crew_chief" ||
      myMembership.role === "team_manager"
    );
  }, [s.roomDetail?.permissions?.canIssueInvite, s.auth.claims?.sub, s.room]);
  const inviteDisabledReason = useMemo(
    () =>
      canIssueInvite ? undefined : "Only athlete, crew chief, or team manager can share race-room invites.",
    [canIssueInvite]
  );
  const roomCode = s.room?.joinCode ?? s.room?.id ?? "";
  const selectedRace = s.room;
  const membershipLabel = (userId: string): string => {
    if (userId === s.auth.claims?.sub) {
      const selfName = s.room?.creatorName?.trim() || s.raceProfile?.creatorName?.trim();
      if (selfName) {
        return selfName;
      }
    }
    if (s.room?.athleteId === userId) {
      return s.room.creatorName?.trim() || s.raceProfile?.creatorName?.trim() || userId;
    }
    return userId;
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: selectedRace?.name?.trim() ? selectedRace.name : "Operate",
      headerRight: () => (
        <Pressable onPress={() => setShowMenuModal(true)} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
          <Text style={{ color: "#93c5fd", fontWeight: "600" }}>Menu</Text>
        </Pressable>
      )
    });
  }, [navigation, selectedRace?.name]);

  /** Include current room so the picker stays complete if /mine omits the active room briefly. */
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
          <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <DSButton
                preset="primary"
                onPress={() => navigation.navigate("RacePlanning", { mode: inRace ? "edit" : "create" })}
              >
                {inRace ? "Update race setup" : "Race setup"}
              </DSButton>
            </View>
          </View>
        </DSCard>

        {!inRace ? (
          <DSCard style={[s.styles.summaryCard, { marginTop: 12 }]}>
            <Text style={s.styles.summaryTitle}>Join an existing race room</Text>
            <Text style={s.styles.body}>
              Enter the 6-digit room code from your crew lead to join their race room as a crew member.
            </Text>
            <View style={{ marginTop: 8 }}>
              <DSTextInput
                value={joinCode}
                onChangeText={setJoinCode}
                autoCapitalize="none"
                keyboardType="number-pad"
                maxLength={6}
                placeholder="6-digit code"
              />
            </View>
            <View style={{ marginTop: 8 }}>
              <DSButton
                preset="secondary"
                disabled={!joinCode.trim() || s.busy}
                onPress={() => void s.onJoinRoomByCode(joinCode)}
              >
                Join race room by code
              </DSButton>
            </View>
          </DSCard>
        ) : null}

        {inRace ? (
          <DSCard style={[s.styles.summaryCard, { marginTop: 12 }]}>
            <Text style={s.styles.body}>Share this room code with your crew so they can join from their app.</Text>
            <View style={{ marginTop: 10 }}>
              <DSButton
                preset="secondary"
                onPress={() => {
                  if (!s.room) return;
                  const raceName = s.room.name?.trim() || "my race";
                  void Share.share({
                    message: `It's time to start prepping. Join my crew for "${raceName}" in CrewCue with the code: "${roomCode}"`
                  });
                }}
                disabled={Boolean(inviteDisabledReason)}
              >
                Add crew members
              </DSButton>
            </View>
          </DSCard>
        ) : null}

      </DSCard>
      <Modal visible={showMenuModal} transparent animationType="fade" onRequestClose={() => setShowMenuModal(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-start", alignItems: "flex-end" }}
          onPress={() => setShowMenuModal(false)}
        >
          <View style={{ marginTop: 88, marginRight: 14, backgroundColor: "#111827", borderRadius: 10, minWidth: 210 }}>
            <Pressable
              onPress={() => {
                setShowMenuModal(false);
                void s.onFetchMyRaceRooms();
                setShowRaceSelectorModal(true);
              }}
              style={{ paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <Text style={{ color: "#f9fafb", fontSize: 15 }}>Change selected race</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setShowMenuModal(false);
                navigation.navigate("RacePlanning", { mode: "create" });
              }}
              style={{ paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <Text style={{ color: "#f9fafb", fontSize: 15 }}>Create new race</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      <Modal
        visible={showRaceSelectorModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRaceSelectorModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 18 }}>
          <View style={{ backgroundColor: "#0f172a", borderRadius: 14, maxHeight: "82%", padding: 14 }}>
            <Text style={{ color: "#f9fafb", fontSize: 18, fontWeight: "700" }}>Select race</Text>
            {selectedRace ? (
              <View style={{ marginTop: 10 }}>
                <Text style={{ color: "#22c55e", fontWeight: "700" }}>
                  Selected: {selectedRace.name}
                </Text>
              </View>
            ) : null}
            <ScrollView style={{ marginTop: 10 }}>
              {raceBuckets.current.length > 0 ? (
                <>
                  <Text style={{ color: "#93c5fd", fontSize: 12, textTransform: "uppercase", marginBottom: 6 }}>Current races</Text>
                  {raceBuckets.current.map((room) => (
                    <Pressable
                      key={room.id}
                      onPress={() => {
                        void s.onSelectRaceRoom(room);
                        setShowRaceSelectorModal(false);
                      }}
                      style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1f2937" }}
                    >
                      <Text style={{ color: "#e5e7eb", fontSize: 15 }}>{room.name}</Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
              {raceBuckets.upcoming.length > 0 ? (
                <>
                  <Text style={{ color: "#93c5fd", fontSize: 12, textTransform: "uppercase", marginTop: 10, marginBottom: 6 }}>
                    Upcoming races
                  </Text>
                  {raceBuckets.upcoming.map((room) => (
                    <Pressable
                      key={room.id}
                      onPress={() => {
                        void s.onSelectRaceRoom(room);
                        setShowRaceSelectorModal(false);
                      }}
                      style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1f2937" }}
                    >
                      <Text style={{ color: "#e5e7eb", fontSize: 15 }}>{room.name}</Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
              {raceBuckets.past.length > 0 ? (
                <>
                  <Text style={{ color: "#94a3b8", fontSize: 12, textTransform: "uppercase", marginTop: 10, marginBottom: 6 }}>
                    Past races
                  </Text>
                  {raceBuckets.past.map((room) => (
                    <Pressable
                      key={room.id}
                      onPress={() => {
                        void s.onSelectRaceRoom(room);
                        setShowRaceSelectorModal(false);
                      }}
                      style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1f2937" }}
                    >
                      <Text style={{ color: "#cbd5e1", fontSize: 15 }}>{room.name}</Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
            </ScrollView>
            <View style={{ marginTop: 12 }}>
              <DSButton preset="secondary" onPress={() => setShowRaceSelectorModal(false)}>
                Close
              </DSButton>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
