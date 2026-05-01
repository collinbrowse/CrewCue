import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppleAuthMarkButton,
  GoogleAuthMarkButton,
  useAuthIdpColumnConstraints
} from "../components/idp/IdpAuthMarkButtons";
import { useAuthedShell } from "../shell/AuthedShellContext";
import { useDSTheme } from "../design-system";
import { applyGuestLandingAuthIntent } from "./guestHomeAuthIntent";
import type { GuestStackParamList } from "./types";

/** Single tweak point for welcome headline (“Crew Q” vs “CrewCue”). */
const ONBOARDING_BRAND_NAME = "CrewCue";

export function GuestHomeScreen(): ReactElement {
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<GuestStackParamList>>();
  const route = useRoute<RouteProp<GuestStackParamList, "Home">>();
  const idpColumn = useAuthIdpColumnConstraints();
  const s = useAuthedShell();
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");

  useEffect(() => {
    const fromRoute = route.params?.authMode;
    if (fromRoute === "signup" || fromRoute === "signin") {
      setAuthMode(fromRoute);
    }
  }, [route.params?.authMode]);

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

  const startAuth = useCallback(
    async (provider: "google" | "apple" | "email") => {
      await applyGuestLandingAuthIntent(authMode, s.onRefreshOnboardingStage);
      if (authMode === "signup") {
        if (s.auth.signUpWithProvider) {
          await s.auth.signUpWithProvider(provider);
        } else {
          await s.auth.signUp();
        }
      } else {
        if (s.auth.signInWithProvider) {
          await s.auth.signInWithProvider(provider);
        } else {
          await s.auth.signIn();
        }
      }
    },
    [authMode, s]
  );

  const idpFlow = authMode === "signup" ? "signup" : "signin";
  const emailLabel = authMode === "signup" ? "Sign up with Email" : "Continue with Email";

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.color.background }]}>
      <View style={[styles.column, { paddingHorizontal: 22 }]}>
        {/* Flex grows: illustration centered in space above headline — headline/buttons stay below */}
        <View style={styles.heroImageFill}>
          <Image
            accessibilityIgnoresInvertColors
            accessibilityRole="image"
            accessibilityLabel="Trail runner illustration"
            resizeMode="contain"
            source={require("../../assets/onboarding/crew-cue-onboarding-runner.png")}
            style={styles.heroImage}
          />
        </View>

        <View style={styles.copyBlock}>
          <Text style={styles.welcomeTitle}>Welcome to {ONBOARDING_BRAND_NAME} 👋</Text>
          <Text style={styles.tagline}>Find your crew and run race day together.</Text>
        </View>

        {s.auth.error ? <Text style={styles.error}>{s.auth.error}</Text> : null}

        <View style={[styles.actions, idpColumn]}>
          <AppleAuthMarkButton
            surface="guestLanding"
            flow={idpFlow}
            onPress={() => void startAuth("apple")}
          />
          <GoogleAuthMarkButton
            surface="guestLanding"
            flow={idpFlow}
            onPress={() => void startAuth("google")}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={emailLabel}
            style={({ pressed }) => [styles.emailButton, pressed && styles.pressed]}
            onPress={() => void startAuth("email")}
          >
            <Text style={styles.emailButtonLabel}>{emailLabel}</Text>
          </Pressable>

          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>or</Text>
            <View style={styles.orLine} />
          </View>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.joinOutlineButton,
              { backgroundColor: theme.color.background },
              pressed && styles.pressed
            ]}
            onPress={() => navigation.navigate("JoinEntry")}
          >
            <Text style={styles.joinOutlineLabel}>Join your crew with a code</Text>
          </Pressable>
        </View>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          {authMode === "signup" ? (
            <Pressable accessibilityRole="button" onPress={() => setAuthMode("signin")}>
              <Text style={styles.footerMuted}>
                Already have an account? <Text style={styles.footerAccent}>Log in</Text>
              </Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setAuthMode("signup")}>
              <Text style={styles.footerMuted}>
                New here? <Text style={styles.footerAccent}>Sign up</Text>
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignSelf: "stretch",
    width: "100%"
  },
  column: {
    flex: 1,
    width: "100%",
    alignSelf: "stretch",
    minHeight: 0
  },
  heroImageFill: {
    flex: 1,
    minHeight: 56,
    width: "100%",
    justifyContent: "center",
    alignItems: "center"
  },
  heroImage: {
    width: "88%",
    maxWidth: 348,
    height: 196
  },
  copyBlock: {
    alignSelf: "stretch",
    alignItems: "flex-start",
    paddingBottom: 18,
    paddingTop: 4
  },
  welcomeTitle: {
    color: "#111827",
    fontSize: 28,
    fontWeight: "800",
    textAlign: "left",
    letterSpacing: -0.6,
    alignSelf: "stretch"
  },
  tagline: {
    marginTop: 10,
    fontSize: 17,
    textAlign: "left",
    color: "#5c5a54",
    fontWeight: "500",
    lineHeight: 24,
    alignSelf: "stretch"
  },
  actions: {
    gap: 12,
    alignSelf: "stretch",
    width: "100%"
  },
  orRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 4
  },
  orLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#c9c4bb"
  },
  orText: {
    color: "#7a756c",
    fontSize: 14,
    fontWeight: "500"
  },
  emailButton: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: "#6B46C1",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16
  },
  emailButtonLabel: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700"
  },
  joinOutlineButton: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "#64748b",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16
  },
  joinOutlineLabel: {
    color: "#111827",
    fontSize: 17,
    fontWeight: "600"
  },
  footer: {
    marginTop: 12,
    alignItems: "center",
    alignSelf: "stretch"
  },
  footerMuted: {
    color: "#5c5a54",
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center"
  },
  footerAccent: {
    color: "#6B46C1",
    fontWeight: "700"
  },
  error: {
    color: "#991b1b",
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    overflow: "hidden"
  },
  pressed: { opacity: 0.88 }
});
