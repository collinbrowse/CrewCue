import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useAuthedShell } from "../shell/AuthedShellContext";
import { ONBOARDING_INTENT_KEY, ONBOARDING_JOIN_DRAFT_KEY, ONBOARDING_NOTIFICATIONS_REQUIRED_KEY } from "./onboardingState";
import type { GuestStackParamList } from "./types";

export function JoinCrewAccountScreen(): ReactElement {
  const route = useRoute<RouteProp<GuestStackParamList, "JoinAccount">>();
  const navigation = useNavigation<NativeStackNavigationProp<GuestStackParamList>>();
  const s = useAuthedShell();
  const { roomCode, displayName } = route.params;

  const onStart = async (provider: "google" | "apple" | "email", mode: "signup" | "signin") => {
    await SecureStore.setItemAsync(ONBOARDING_INTENT_KEY, "joinCrew");
    await SecureStore.setItemAsync(ONBOARDING_NOTIFICATIONS_REQUIRED_KEY, "true");
    await SecureStore.setItemAsync(ONBOARDING_JOIN_DRAFT_KEY, JSON.stringify({ roomCode, displayName }));
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
      <Text style={styles.title}>Create your account</Text>
      <Text style={styles.body}>We just need to make an account so you will not lose access to your crew.</Text>
      <ProviderButton label="Sign up with Google" onPress={() => void onStart("google", "signup")} />
      <ProviderButton label="Sign up with Apple" onPress={() => void onStart("apple", "signup")} />
      <ProviderButton label="Sign up with Email" onPress={() => void onStart("email", "signup")} />
      <Pressable onPress={() => navigation.navigate("AuthOptions", { mode: "signin" })}>
        <Text style={styles.link}>Already have an account? Choose sign in options</Text>
      </Pressable>
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
  root: { flex: 1, backgroundColor: "#0f172a", padding: 20, gap: 12, justifyContent: "center" },
  title: { color: "#f8fafc", fontSize: 32, fontWeight: "800" },
  body: { color: "#d1d5db", fontSize: 16, marginBottom: 6 },
  button: { minHeight: 54, borderRadius: 12, backgroundColor: "#1d4ed8", alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#ffffff", fontWeight: "700", fontSize: 17 },
  link: { color: "#93c5fd", textAlign: "center", marginTop: 8, textDecorationLine: "underline" },
  back: { color: "#94a3b8", textAlign: "center", marginTop: 6 }
});
