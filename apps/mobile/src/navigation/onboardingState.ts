export const ONBOARDING_STAGE_KEY = "crewcue.guest.onboardingStage.v2";

export type OnboardingStage = "splash" | "product" | "auth" | "signupAuth" | "notifications" | "done";

export function requiresOnboardingGateForAuthenticatedUser(stage: OnboardingStage): boolean {
  return stage === "signupAuth" || stage === "notifications";
}
