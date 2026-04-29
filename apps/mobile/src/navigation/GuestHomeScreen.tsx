import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { OperationalSummarySections } from "../components/OperationalSummarySections";
import { MobileShellSessionHeader } from "../components/MobileShellSessionHeader";
import { DSButton, DSCard } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";

const ONBOARDING_KEY = "crewcue.guest.onboardingCompleted";

const ONBOARDING_STEPS = [
  {
    title: "Know what to do next",
    body: "CrewCue keeps your race room, task board, and checkpoints aligned so your team can move faster."
  },
  {
    title: "Respond quickly with context",
    body: "Live status, incidents, and recommendations stay in one place so decisions are clear under pressure."
  },
  {
    title: "Start with your normal login",
    body: "Use your CrewCue account to enter operations, invite crew, and keep shared notes synchronized."
  }
] as const;

export function GuestHomeScreen(): ReactElement {
  const s = useAuthedShell();
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [onboardingIndex, setOnboardingIndex] = useState(0);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const value = await SecureStore.getItemAsync(ONBOARDING_KEY);
        if (!mounted) {
          return;
        }
        setOnboardingDone(value === "true");
      } finally {
        if (mounted) {
          setOnboardingReady(true);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const currentStep = ONBOARDING_STEPS[onboardingIndex];
  const isFinalStep = onboardingIndex === ONBOARDING_STEPS.length - 1;

  const primaryButtonLabel = useMemo(() => {
    if (!onboardingReady) {
      return "Preparing sign-in...";
    }
    if (!onboardingDone) {
      return isFinalStep ? "Get started" : "Continue";
    }
    if (s.auth.status === "authenticating") {
      return "Opening secure login...";
    }
    if (s.auth.status === "error") {
      return "Try sign-in again";
    }
    return "Sign in";
  }, [isFinalStep, onboardingDone, onboardingReady, s.auth.status]);

  const completeOnboarding = async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, "true");
    setOnboardingDone(true);
  };

  const handlePrimaryPress = () => {
    if (!onboardingReady) {
      return;
    }

    if (!onboardingDone) {
      if (isFinalStep) {
        void completeOnboarding();
      } else {
        setOnboardingIndex((value) => value + 1);
      }
      return;
    }

    void s.auth.signIn();
  };

  return (
    <ScrollView
      style={s.styles.container}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>CrewCue</Text>
        <Text style={s.styles.subtitle}>
          {onboardingDone ? "Sign in to start race operations" : "A fast onboarding for first-time operators"}
        </Text>

        <MobileShellSessionHeader
          styles={s.styles}
          baseUrl={s.baseUrl}
          redirectUri={s.auth.redirectUri}
          authStatus={s.auth.status}
          claims={s.auth.claims}
          authError={s.auth.error}
          pendingOutboxCount={s.pendingOutboxCount}
          outboxTotal={s.outbox.length}
          appState={s.appState}
        />

        {!onboardingDone ? (
          <View style={{ marginTop: 16, gap: 8 }}>
            <View style={s.styles.summaryCard}>
              <Text style={s.styles.summaryTitle}>
                Step {onboardingIndex + 1} of {ONBOARDING_STEPS.length}: {currentStep.title}
              </Text>
              <Text style={s.styles.body}>{currentStep.body}</Text>
            </View>
            <DSButton preset="primary" onPress={handlePrimaryPress} disabled={!onboardingReady}>
              {primaryButtonLabel}
            </DSButton>
            <DSButton
              preset="secondary"
              onPress={() => {
                void completeOnboarding();
              }}
              disabled={!onboardingReady}
            >
              Skip introduction
            </DSButton>
          </View>
        ) : (
          <View style={{ marginTop: 16, gap: 8 }}>
            <DSButton
              preset="primary"
              onPress={handlePrimaryPress}
              disabled={s.auth.status === "authenticating" || !onboardingReady}
            >
              {primaryButtonLabel}
            </DSButton>
            {s.auth.status === "error" ? (
              <Text style={s.styles.errorText}>
                {s.auth.error ?? "Login did not complete. Please try again."}
              </Text>
            ) : null}
            {s.auth.status === "bootstrapping" ? (
              <Text style={s.styles.mutedText}>Restoring your previous session...</Text>
            ) : null}
            {s.auth.status === "anonymous" ? (
              <Text style={s.styles.mutedText}>Use your CrewCue login to continue.</Text>
            ) : null}
            <Text style={s.styles.mutedText}>Secure login uses your normal account and returns here automatically.</Text>
          </View>
        )}

        {s.auth.status === "authenticating" ? (
          <View style={s.styles.statusRail}>
            <Text style={s.styles.statusRailTitle}>Signing in</Text>
            <Text style={s.styles.statusRailItem}>Waiting for secure login to complete...</Text>
          </View>
        ) : null}

        {s.auth.status === "error" && onboardingDone ? (
          <View style={s.styles.statusRail}>
            <Text style={s.styles.statusRailTitle}>Sign-in needs attention</Text>
            <Text style={s.styles.statusRailItem}>
              Retry sign-in. If this keeps happening, verify your Auth0 callback URL configuration.
            </Text>
          </View>
        ) : null}

        <OperationalSummarySections
          styles={s.styles}
          room={s.room}
          roomDetail={s.roomDetail}
          lastPing={s.lastPing}
          syncHealth={s.syncHealth}
          projection={s.projection}
          projectionPolledAt={s.projectionPolledAt}
          lastProtocolNote={s.lastProtocolNote}
          timeline={s.timeline}
          incidents={s.incidents}
          latestRecommendation={s.latestRecommendation}
          latestExplainability={s.latestExplainability}
          planDelta={s.planDelta}
          taskBoard={s.taskBoard}
          onToggleResolvedSource={s.onToggleResolvedSource}
          canToggleResolvedSource={s.canUseCheckpointControls}
          onEnqueueTaskAction={s.onEnqueueTaskAction}
          canMutateTasks={Boolean(s.room?.status === "active" && s.canEditTasks && !s.busy)}
          taskAssigneeUserId={s.auth.claims?.sub}
          taskAssigneeRole={s.currentRoomRole}
        />
      </DSCard>
    </ScrollView>
  );
}
