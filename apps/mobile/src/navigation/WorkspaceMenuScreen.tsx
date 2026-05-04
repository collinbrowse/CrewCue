import { useMemo, useState, type ReactElement } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { DSButton, DSCard } from "../design-system";
import { useDSTheme } from "../design-system/theme";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { OperateStackParamList } from "./types";

export function WorkspaceMenuScreen(): ReactElement {
  const s = useAuthedShell();
  const theme = useDSTheme();
  const navigation = useNavigation<NativeStackNavigationProp<OperateStackParamList>>();
  const [changingRace, setChangingRace] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | undefined>(undefined);
  const isOwner = Boolean(s.room && s.auth.claims?.sub && s.room.athleteId === s.auth.claims.sub);

  const selectedRaceName = useMemo(() => s.room?.name?.trim() || "No race selected", [s.room?.name]);
  const executeSignOut = () => {
    if (signingOut) {
      return;
    }
    setSignOutError(undefined);
    setSigningOut(true);
    void s
      .onSignOut()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unable to sign out right now. Please try again.";
        setSignOutError(message);
      })
      .finally(() => {
        setSigningOut(false);
      });
  };

  const confirmSignOut = () => {
    if (signingOut) {
      return;
    }
    Alert.alert("Sign out?", "You will need to sign in again to access your races.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: executeSignOut
      }
    ]);
  };

  return (
    <ScrollView style={s.styles.container} contentContainerStyle={[s.styles.scroll, { paddingBottom: 28 }]}>
      <DSCard style={s.styles.card}>
        <DSCard style={[s.styles.summaryCard, styles.heroCard]}>
          <Text style={[styles.kicker, { color: theme.color.primary }]}>Selected race</Text>
          <Text style={[styles.heroTitle, { color: theme.color.text }]}>{selectedRaceName}</Text>
          <Text style={[styles.heroBody, { color: theme.color.body }]}>
            Use this menu to jump into joining a room, member management, or starting a new race setup flow.
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
                navigation.navigate("OperateHome");
              }}
            >
              Back to Operate
            </DSButton>
          </View>
        </DSCard>

        <DSCard style={[s.styles.summaryCard, styles.section]}>
          <Text style={s.styles.summaryTitle}>Account</Text>
          <Text style={s.styles.body}>Sign out of this device and return to the login flow.</Text>
          <View style={styles.buttonSpacing}>
            <DSButton preset="danger" onPress={confirmSignOut} disabled={signingOut}>
              {signingOut ? "Signing out..." : "Sign out"}
            </DSButton>
          </View>
          {signOutError ? <Text style={[s.styles.errorText, styles.errorSpacing]}>{signOutError}</Text> : null}
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
    borderColor: "#c9b8ed",
    backgroundColor: "rgba(107,70,193,0.12)"
  },
  kicker: {
    color: "#93c5fd",
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
  },
  errorSpacing: {
    marginTop: 10
  }
});
