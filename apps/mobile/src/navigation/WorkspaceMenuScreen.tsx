import { useMemo, useState, type ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { DSButton, DSCard } from "../design-system";
import { useDSTheme } from "../design-system/theme";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { MapStackParamList } from "./types";

export function WorkspaceMenuScreen(): ReactElement {
  const s = useAuthedShell();
  const theme = useDSTheme();
  const navigation = useNavigation<NativeStackNavigationProp<MapStackParamList>>();
  const [changingRace, setChangingRace] = useState(false);

  const isOwner = Boolean(s.room && s.auth.claims?.sub && s.room.athleteId === s.auth.claims.sub);

  const selectedRaceName = useMemo(() => s.room?.name?.trim() || "No race selected", [s.room?.name]);

  return (
    <ScrollView style={s.styles.container} contentContainerStyle={[s.styles.scroll, { paddingBottom: 28 }]}>
      <DSCard style={s.styles.card}>
        <DSCard style={[s.styles.summaryCard, styles.heroCard]}>
          <Text style={[styles.kicker, { color: theme.color.primary }]}>Selected race</Text>
          <Text style={[styles.heroTitle, { color: theme.color.text }]}>{selectedRaceName}</Text>
          <Text style={[styles.heroBody, { color: theme.color.body }]}>
            Join a room, manage members, or start race setup. Appearance, offline maps, and sign out are on the Profile tab.
          </Text>
        </DSCard>

        <DSCard style={[s.styles.summaryCard, styles.section]}>
          <Text style={s.styles.summaryTitle}>Join race room</Text>
          <Text style={s.styles.body}>Enter a room code and profile details before joining your crew.</Text>
          <View style={styles.buttonSpacing}>
            <DSButton preset="primary" onPress={() => navigation.navigate("JoinRoomDetails")}>
              Join race room
            </DSButton>
          </View>
        </DSCard>

        <DSCard style={[s.styles.summaryCard, styles.section]}>
          <Text style={s.styles.summaryTitle}>{isOwner ? "Member management" : "Room members"}</Text>
          <Text style={s.styles.body}>
            {isOwner
              ? "Edit roles, invite new members, and remove people from the room."
              : "View current members and each person's role. Only the race owner can make changes."}
          </Text>
          <View style={styles.buttonSpacing}>
            <DSButton preset="secondary" onPress={() => navigation.navigate("ManageRoomMembers")}>
              {isOwner ? "Manage room members" : "View room members"}
            </DSButton>
          </View>
        </DSCard>

        <DSCard style={[s.styles.summaryCard, styles.section]}>
          <Text style={s.styles.summaryTitle}>Race workspace</Text>
          <View style={styles.buttonSpacing}>
            <DSButton
              preset="secondary"
              onPress={() => {
                setChangingRace(true);
                void s.onFetchMyRaceRooms().finally(() => setChangingRace(false));
              }}
              disabled={changingRace}
            >
              {changingRace ? "Refreshing races..." : "Refresh race list"}
            </DSButton>
            <DSButton preset="secondary" onPress={() => navigation.navigate("RacePlanning", { mode: "create" })}>
              Create new race
            </DSButton>
            <DSButton
              preset="secondary"
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                  return;
                }
                navigation.navigate("MapHome");
              }}
            >
              Back to map
            </DSButton>
          </View>
        </DSCard>
      </DSCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(125, 128, 145, 0.6)",
    backgroundColor: "rgba(125, 128, 145, 0.12)"
  },
  kicker: {
    textTransform: "uppercase",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: "800",
    marginTop: 8
  },
  heroBody: {
    marginTop: 8,
    lineHeight: 22
  },
  section: {
    marginTop: 12
  },
  buttonSpacing: {
    gap: 8,
    marginTop: 10
  }
});
