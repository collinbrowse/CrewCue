import * as SecureStore from "expo-secure-store";
import {
  ONBOARDING_INTENT_KEY,
  ONBOARDING_JOIN_DRAFT_KEY,
  ONBOARDING_NOTIFICATIONS_REQUIRED_KEY
} from "./onboardingState";

/** Applies Secure Store onboarding intent for guest landing Apple/Google/email — mirrors legacy AuthOptionsScreen. */
export async function applyGuestLandingAuthIntent(
  mode: "signup" | "signin",
  onRefreshOnboardingStage: () => Promise<void>
): Promise<void> {
  const hasJoinDraft = Boolean(await SecureStore.getItemAsync(ONBOARDING_JOIN_DRAFT_KEY));
  const intent = mode === "signup" ? "signupAthlete" : hasJoinDraft ? "joinCrew" : "none";
  await SecureStore.setItemAsync(ONBOARDING_INTENT_KEY, intent);
  await SecureStore.setItemAsync(ONBOARDING_NOTIFICATIONS_REQUIRED_KEY, intent === "none" ? "false" : "true");
  await onRefreshOnboardingStage();
}
