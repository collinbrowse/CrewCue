export const ONBOARDING_INTENT_KEY = "crewcue.guest.onboardingIntent.v3";
export const ONBOARDING_JOIN_DRAFT_KEY = "crewcue.guest.joinDraft.v1";
export const ONBOARDING_NOTIFICATIONS_SEEN_KEY = "crewcue.guest.notificationsSeen.v1";
export const ONBOARDING_NOTIFICATIONS_REQUIRED_KEY = "crewcue.guest.notificationsRequired.v1";

export type OnboardingIntent = "none" | "signupAthlete" | "joinCrew";

export type OnboardingJoinDraft = {
  roomCode: string;
  displayName: string;
};
