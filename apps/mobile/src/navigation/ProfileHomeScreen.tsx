import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Alert, Image, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { DSButton, DSCard } from "../design-system";
import { useDSTheme, useDesignSystemSelection } from "../design-system/theme";
import { useAuthedShell } from "../shell/AuthedShellContext";
import { getOfflineMapsUnlocked, setOfflineMapsUnlocked } from "../preferences/offlineMaps";
import type { CrewMainTabParamList, ProfileStackParamList } from "./types";

const RUNNER_AVATAR = require("../../assets/onboarding/crew-cue-onboarding-runner.png");

type ProfileNav = CompositeNavigationProp<
  NativeStackNavigationProp<ProfileStackParamList, "ProfileHome">,
  BottomTabNavigationProp<CrewMainTabParamList>
>;

export function ProfileHomeScreen(): ReactElement {
  const s = useAuthedShell();
  const theme = useDSTheme();
  const navigation = useNavigation<ProfileNav>();
  const {
    selectedDesignSystemId,
    setDesignSystemId,
    designModeOverride,
    setDesignModeOverride,
    systemMode,
    activeMode
  } = useDesignSystemSelection();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | undefined>(undefined);
  const [offlineMapsUnlocked, setOfflineMapsUnlockedState] = useState(false);

  useEffect(() => {
    void getOfflineMapsUnlocked().then(setOfflineMapsUnlockedState);
  }, []);

  const emailLabel = useMemo(() => s.auth.claims?.email?.trim() || "Signed in", [s.auth.claims?.email]);
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
        <DSCard style={[s.styles.summaryCard, styles.hero]}>
          <Image source={RUNNER_AVATAR} style={styles.avatar} accessibilityLabel="Athlete" />
          <Text style={[s.styles.summaryTitle, { marginTop: 12 }]}>Profile</Text>
          <Text style={[s.styles.body, { marginTop: 4 }]}>{emailLabel}</Text>
        </DSCard>

        <DSCard style={[s.styles.summaryCard, styles.section]}>
          <Text style={s.styles.summaryTitle}>Add a race</Text>
          <Text style={s.styles.body}>
            Start a brand new race or join an existing room from Profile.
          </Text>
          <View style={styles.gap}>
            <DSButton
              preset="secondary"
              onPress={() => navigation.navigate("ProfileRaceSetup", { mode: "create" })}
            >
              Create new race
            </DSButton>
            <DSButton preset="secondary" onPress={() => navigation.navigate("ProfileJoinRoomDetails")}>
              Join race room
            </DSButton>
          </View>
        </DSCard>

        <DSCard style={[s.styles.summaryCard, styles.section]}>
          <Text style={s.styles.summaryTitle}>Race & workspace</Text>
          <Text style={s.styles.body}>Manage members and room controls for your current race.</Text>
          <Text style={[s.styles.code, { marginTop: 8 }]}>{selectedRaceName}</Text>
          <View style={styles.gap}>
            <DSButton
              preset="secondary"
              onPress={() => navigation.navigate("ProfileManageRoomMembers")}
            >
              {isOwner ? "Manage room members" : "View room members"}
            </DSButton>
          </View>
        </DSCard>

        <DSCard style={[s.styles.summaryCard, styles.section]}>
          <Text style={s.styles.summaryTitle}>Design system</Text>
          <Text style={s.styles.body}>Switch between Kinetic and Performance. Light/dark follows device mode unless overridden.</Text>
          <View style={styles.gap}>
            <DSButton
              preset={selectedDesignSystemId === "kinetic" ? "primary" : "secondary"}
              onPress={() => void setDesignSystemId("kinetic")}
            >
              Kinetic
            </DSButton>
            <DSButton
              preset={selectedDesignSystemId === "performance" ? "primary" : "secondary"}
              onPress={() => void setDesignSystemId("performance")}
            >
              Performance
            </DSButton>
          </View>
          <View style={[styles.gap, { marginTop: 12 }]}>
            <Text style={s.styles.summaryTitle}>Color mode</Text>
            <DSButton preset={designModeOverride === "auto" ? "primary" : "secondary"} onPress={() => void setDesignModeOverride("auto")}>
              Auto (device)
            </DSButton>
            <DSButton preset={designModeOverride === "light" ? "primary" : "secondary"} onPress={() => void setDesignModeOverride("light")}>
              Force Light
            </DSButton>
            <DSButton preset={designModeOverride === "dark" ? "primary" : "secondary"} onPress={() => void setDesignModeOverride("dark")}>
              Force Dark
            </DSButton>
          </View>
          {__DEV__ ? (
            <Text style={[s.styles.body, styles.debug]}>
              Debug: system={systemMode} override={designModeOverride} active={activeMode} design={selectedDesignSystemId}
            </Text>
          ) : null}
        </DSCard>

        <DSCard style={[s.styles.summaryCard, styles.section]}>
          <Text style={s.styles.summaryTitle}>Offline map downloads</Text>
          <Text style={s.styles.body}>
            Placeholder entitlement (future subscription SKU). Unlocking allows creating corridor offline packs around routes from
            Navigate.
          </Text>
          <View style={[styles.rowBetween, styles.gap]}>
            <Text style={[s.styles.body, { flex: 1 }]}>{offlineMapsUnlocked ? "Unlocked" : "Locked"}</Text>
            <Switch
              value={offlineMapsUnlocked}
              onValueChange={(value) => {
                setOfflineMapsUnlockedState(value);
                void setOfflineMapsUnlocked(value);
              }}
              trackColor={{ false: theme.color.border, true: theme.color.primary }}
            />
          </View>
        </DSCard>

        <DSCard style={[s.styles.summaryCard, styles.section]}>
          <Text style={s.styles.summaryTitle}>Account</Text>
          <Text style={s.styles.body}>Sign out of this device and return to the login flow.</Text>
          <View style={styles.gap}>
            <DSButton preset="danger" onPress={confirmSignOut} disabled={signingOut}>
              {signingOut ? "Signing out..." : "Sign out"}
            </DSButton>
          </View>
          {signOutError ? <Text style={[s.styles.errorText, { marginTop: 10 }]}>{signOutError}</Text> : null}
        </DSCard>
      </DSCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: "center",
    paddingVertical: 20
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48
  },
  section: { marginTop: 12 },
  gap: { gap: 8, marginTop: 10 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  debug: { marginTop: 12, fontSize: 12 }
});
