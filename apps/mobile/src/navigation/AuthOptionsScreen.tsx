import { useRoute, type RouteProp, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useAuthedShell } from "../shell/AuthedShellContext";
import {
  ONBOARDING_INTENT_KEY,
  ONBOARDING_JOIN_DRAFT_KEY,
  ONBOARDING_NOTIFICATIONS_REQUIRED_KEY
} from "./onboardingState";
import type { GuestStackParamList } from "./types";

export function AuthOptionsScreen(): ReactElement {
  const s = useAuthedShell();
  const route = useRoute<RouteProp<GuestStackParamList, "AuthOptions">>();
  const navigation = useNavigation<NativeStackNavigationProp<GuestStackParamList>>();
  const mode = route.params.mode;

  const startAuth = async (provider: "google" | "apple" | "email") => {
    const hasJoinDraft = Boolean(await SecureStore.getItemAsync(ONBOARDING_JOIN_DRAFT_KEY));
    const intent = mode === "signup" ? "signupAthlete" : hasJoinDraft ? "joinCrew" : "none";
    await SecureStore.setItemAsync(ONBOARDING_INTENT_KEY, intent);
    await SecureStore.setItemAsync(ONBOARDING_NOTIFICATIONS_REQUIRED_KEY, intent === "none" ? "false" : "true");
    await s.onRefreshOnboardingStage();
    if (mode === "signup") {
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
  };

  return (
    <View style={styles.root}>
      <Text style={styles.kicker}>{mode === "signup" ? "Create account" : "Sign back in"}</Text>
      <Text style={styles.title}>{mode === "signup" ? "Get started with CrewCue" : "Welcome back"}</Text>
      {s.auth.error ? <Text style={styles.error}>{s.auth.error}</Text> : null}
      <View style={styles.actions}>
        <ProviderButton label={`${mode === "signup" ? "Sign up" : "Continue"} with Google`} onPress={() => void startAuth("google")} />
        <ProviderButton label={`${mode === "signup" ? "Sign up" : "Continue"} with Apple`} onPress={() => void startAuth("apple")} />
        <ProviderButton label={`${mode === "signup" ? "Sign up" : "Continue"} with Email`} onPress={() => void startAuth("email")} />
      </View>
      <Pressable onPress={() => navigation.goBack()}>
        <Text style={styles.back}>Back</Text>
      </Pressable>
    </View>
  );
}

function ProviderButton({ label, onPress }: { label: string; onPress: () => void }): ReactElement {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a", padding: 20, justifyContent: "center", gap: 14 },
  kicker: { color: "#93c5fd", fontSize: 14, textTransform: "uppercase", fontWeight: "700" },
  title: { color: "#f8fafc", fontSize: 36, fontWeight: "800" },
  actions: { gap: 10, marginTop: 12 },
  button: { minHeight: 54, borderRadius: 12, backgroundColor: "#1e40af", alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "700" },
  back: { color: "#93c5fd", marginTop: 12, textAlign: "center", fontSize: 16, textDecorationLine: "underline" },
  error: { color: "#fee2e2", backgroundColor: "rgba(127,29,29,0.5)", borderRadius: 10, padding: 10 }
});
