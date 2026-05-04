import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppleAuthMarkButton,
  GoogleAuthMarkButton,
  useAuthIdpColumnConstraints
} from "../components/idp/IdpAuthMarkButtons";
import { DSButton, useDSTheme } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import { ONBOARDING_INTENT_KEY, ONBOARDING_JOIN_DRAFT_KEY, ONBOARDING_NOTIFICATIONS_REQUIRED_KEY } from "./onboardingState";
import type { GuestStackParamList } from "./types";

export function JoinCrewAccountScreen(): ReactElement {
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
  const idpColumn = useAuthIdpColumnConstraints();
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
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 16,
          backgroundColor: theme.color.background
        }
      ]}
    >
      <Text style={[styles.title, { color: theme.color.authHeading }]}>Create your account</Text>
      <Text style={[styles.body, { color: theme.color.authBody }]}>
        We just need to make an account so you will not lose access to your crew.
      </Text>
      <View style={[styles.providers, idpColumn]}>
        <GoogleAuthMarkButton flow="signup" onPress={() => void onStart("google", "signup")} />
        <AppleAuthMarkButton flow="signup" onPress={() => void onStart("apple", "signup")} />
        <ProviderButton label="Sign up with Email" onPress={() => void onStart("email", "signup")} />
      </View>
      <Pressable
        onPress={() =>
          navigation.navigate({
            name: "Home",
            params: { authMode: "signin" },
            merge: true
          })
        }
      >
        <Text style={[styles.link, { color: theme.color.authAccent }]}>Already have an account? Log in</Text>
      </Pressable>
      <Pressable onPress={() => navigation.goBack()}>
        <Text style={[styles.back, { color: theme.color.authBody }]}>Back</Text>
      </Pressable>
    </View>
  );
}

function ProviderButton({ label, onPress }: { label: string; onPress: () => void }): ReactElement {
  return (
    <DSButton preset="authPrimary" onPress={onPress}>
      {label}
    </DSButton>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 20,
    gap: 12,
    justifyContent: "center",
    alignSelf: "stretch",
    width: "100%"
  },
  providers: { gap: 12, alignSelf: "stretch", width: "100%" },
  title: { fontSize: 32, fontWeight: "800" },
  body: { fontSize: 16, marginBottom: 6 },
  link: { textAlign: "center", marginTop: 8, textDecorationLine: "underline", fontWeight: "600" },
  back: { textAlign: "center", marginTop: 6, fontWeight: "500" }
});
