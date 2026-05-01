import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { GuestStackParamList } from "./types";

export function GuestHomeScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<GuestStackParamList>>();
  const s = useAuthedShell();

  useEffect(() => {
    if (s.auth.status !== "authenticated") {
      return;
    }
    if (s.onboardingIntent === "signupAthlete") {
      navigation.navigate("AthleteSetup");
      return;
    }
    if (s.onboardingIntent === "joinCrew" && !s.onboardingJoinDraft && s.onboardingNotificationsRequired) {
      navigation.navigate("Notifications");
      return;
    }
    if (s.onboardingNotificationsRequired && !s.onboardingJoinDraft) {
      navigation.navigate("Notifications");
    }
  }, [
    navigation,
    s.auth.status,
    s.onboardingIntent,
    s.onboardingJoinDraft,
    s.onboardingNotificationsRequired
  ]);
  return (
    <View style={[styles.root, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.topWrap}>
        <View style={styles.heroArt}>
          <Text style={styles.heroArtLabel}>🏃‍♀️ 🚴‍♂️ 🏔️</Text>
        </View>
        <Text style={styles.brand}>CrewCue</Text>
        <Text style={styles.tagline}>Find your crew and run race day together.</Text>
      </View>

      <View style={styles.actionWrap}>
        <ActionButton label="Sign up" onPress={() => navigation.navigate("AuthOptions", { mode: "signup" })} />
        <ActionButton label="Sign back in" onPress={() => navigation.navigate("AuthOptions", { mode: "signin" })} />
        <ActionButton label="Join your crew with a code" onPress={() => navigation.navigate("JoinEntry")} />
      </View>
    </View>
  );
}

type ActionButtonProps = {
  label: string;
  onPress: () => void;
};

function ActionButton({ label, onPress }: ActionButtonProps): ReactElement {
  return (
    <Pressable onPress={onPress} style={styles.actionButton}>
      <Text style={styles.actionButtonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: 18,
    justifyContent: "space-between"
  },
  topWrap: {
    alignItems: "center",
    marginTop: 28
  },
  heroArt: {
    width: 220,
    height: 180,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center"
  },
  heroArtLabel: {
    fontSize: 28
  },
  brand: {
    marginTop: 30,
    color: "#00a882",
    fontWeight: "900",
    fontSize: 48,
    letterSpacing: -1
  },
  tagline: {
    marginTop: 8,
    fontSize: 24,
    textAlign: "center",
    color: "#064e3b",
    fontWeight: "700"
  },
  actionWrap: {
    gap: 12,
    marginBottom: 10
  },
  actionButton: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: "#4ade80",
    justifyContent: "center",
    alignItems: "center"
  },
  actionButtonLabel: {
    color: "#052e16",
    fontSize: 20,
    fontWeight: "800"
  }
});
