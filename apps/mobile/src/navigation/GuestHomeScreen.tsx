import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import { OperationalSummarySections } from "../components/OperationalSummarySections";
import { MobileShellSessionHeader } from "../components/MobileShellSessionHeader";
import { DSButton, DSCard } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";

const ONBOARDING_STAGE_KEY = "crewcue.guest.onboardingStage.v1";
const ONBOARDING_SPLASH_MS = 1400;

type OnboardingStage = "splash" | "product" | "auth" | "notifications" | "done";

const PRODUCT_STEPS = [
  {
    title: "See the race at a glance",
    body: "CrewCue keeps your room status, checkpoints, and split context in one place so your crew always knows what comes next."
  },
  {
    title: "Coordinate the full crew quickly",
    body: "Share updates, assign actions, and keep everyone aligned without jumping across separate tools."
  },
  {
    title: "Make faster decisions under pressure",
    body: "Live pings, incidents, and recommendations surface the right signals so the team can respond with confidence."
  }
] as const;

export function GuestHomeScreen(): ReactElement {
  const s = useAuthedShell();
  const [stageReady, setStageReady] = useState(false);
  const [onboardingStage, setOnboardingStage] = useState<OnboardingStage>("splash");
  const [productIndex, setProductIndex] = useState(0);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [notificationsMessage, setNotificationsMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    let splashTimer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      try {
        const storedStage = (await SecureStore.getItemAsync(ONBOARDING_STAGE_KEY)) as OnboardingStage | null;
        if (!mounted) {
          return;
        }
        if (storedStage === "product" || storedStage === "auth" || storedStage === "notifications" || storedStage === "done") {
          setOnboardingStage(storedStage);
          setStageReady(true);
          return;
        }

        setOnboardingStage("splash");
        splashTimer = setTimeout(() => {
          if (!mounted) {
            return;
          }
          setOnboardingStage("product");
          setStageReady(true);
          void SecureStore.setItemAsync(ONBOARDING_STAGE_KEY, "product");
        }, ONBOARDING_SPLASH_MS);
      } finally {
        if (mounted && splashTimer === undefined) {
          setStageReady(true);
        }
      }
    })();

    return () => {
      mounted = false;
      if (splashTimer) {
        clearTimeout(splashTimer);
      }
    };
  }, []);

  const currentProductStep = PRODUCT_STEPS[productIndex];
  const isFinalProductStep = productIndex === PRODUCT_STEPS.length - 1;

  const primaryButtonLabel = useMemo(() => {
    if (!stageReady) {
      return "Preparing sign-in...";
    }
    if (onboardingStage === "product") {
      return isFinalProductStep ? "Continue to sign in" : "Next";
    }
    if (onboardingStage === "auth") {
      if (s.auth.status === "authenticating") {
        return "Opening secure login...";
      }
      return "Continue with Auth0";
    }
    if (onboardingStage === "notifications") {
      return notificationsBusy ? "Updating notifications..." : "Enable notifications";
    }
    if (s.auth.status === "error") {
      return "Try sign-in again";
    }
    return "Sign in";
  }, [isFinalProductStep, notificationsBusy, onboardingStage, s.auth.status, stageReady]);

  const setStage = async (nextStage: OnboardingStage) => {
    setOnboardingStage(nextStage);
    await SecureStore.setItemAsync(ONBOARDING_STAGE_KEY, nextStage);
  };

  const handleEnableNotifications = async () => {
    setNotificationsBusy(true);
    setNotificationsMessage(undefined);
    try {
      const existing = await Notifications.getPermissionsAsync();
      const final = existing.status === "granted" ? existing : await Notifications.requestPermissionsAsync();
      if (final.status === "granted") {
        setNotificationsMessage("Notifications enabled. You are all set.");
      } else {
        setNotificationsMessage("Notifications were skipped. You can enable them later in Settings.");
      }
    } catch {
      setNotificationsMessage("Could not update notifications here. You can enable them later in Settings.");
    } finally {
      await setStage("done");
      setNotificationsBusy(false);
    }
  };

  const handlePrimaryPress = () => {
    if (!stageReady) return;

    if (onboardingStage === "product") {
      if (isFinalProductStep) {
        void setStage("auth");
      } else {
        setProductIndex((value) => value + 1);
      }
      return;
    }

    if (onboardingStage === "auth" || onboardingStage === "done") {
      void s.auth.signIn();
      return;
    }

    if (onboardingStage === "notifications") {
      void handleEnableNotifications();
    }
  };

  return (
    <ScrollView
      style={s.styles.container}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <DSCard style={s.styles.card}>
        {onboardingStage === "splash" && stageReady ? null : <Text style={s.styles.title}>CrewCue</Text>}
        {onboardingStage === "splash" ? (
          <>
            <Text style={s.styles.subtitle}>Race-day command for athletes and crew</Text>
            <View style={s.styles.summaryCard}>
              <Text style={s.styles.summaryTitle}>Loading your workspace...</Text>
              <Text style={s.styles.body}>Preparing onboarding and secure sign-in.</Text>
            </View>
          </>
        ) : null}
        {onboardingStage === "product" ? (
          <Text style={s.styles.subtitle}>Built for fast race-day decisions</Text>
        ) : null}
        {onboardingStage === "auth" || onboardingStage === "done" ? (
          <Text style={s.styles.subtitle}>Sign in to continue race operations</Text>
        ) : null}
        {onboardingStage === "notifications" ? (
          <Text style={s.styles.subtitle}>Enable alerts for real-time crew coordination</Text>
        ) : null}

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

        {onboardingStage === "product" ? (
          <View style={{ marginTop: 16, gap: 8 }}>
            <View style={s.styles.summaryCard}>
              <Text style={s.styles.summaryTitle}>
                Product tour {productIndex + 1} of {PRODUCT_STEPS.length}: {currentProductStep.title}
              </Text>
              <Text style={s.styles.body}>{currentProductStep.body}</Text>
            </View>
            <DSButton preset="primary" onPress={handlePrimaryPress} disabled={!stageReady}>
              {primaryButtonLabel}
            </DSButton>
            <DSButton
              preset="secondary"
              onPress={() => {
                void setStage("auth");
              }}
              disabled={!stageReady}
            >
              Sign in now
            </DSButton>
          </View>
        ) : null}

        {onboardingStage === "auth" || onboardingStage === "done" ? (
          <View style={{ marginTop: 16, gap: 8 }}>
            <DSButton
              preset="primary"
              onPress={handlePrimaryPress}
              disabled={s.auth.status === "authenticating" || !stageReady}
            >
              {primaryButtonLabel}
            </DSButton>
            {onboardingStage === "auth" ? (
              <DSButton
                preset="secondary"
                onPress={() => {
                  void setStage("notifications");
                }}
                disabled={!stageReady}
              >
                Continue without notifications
              </DSButton>
            ) : null}
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
        ) : null}

        {onboardingStage === "notifications" ? (
          <View style={{ marginTop: 16, gap: 8 }}>
            <View style={s.styles.summaryCard}>
              <Text style={s.styles.summaryTitle}>Turn on notifications</Text>
              <Text style={s.styles.body}>
                Alerts keep your crew synced on pings, incident updates, and assignment changes during active race operations.
              </Text>
            </View>
            <DSButton preset="primary" onPress={handlePrimaryPress} disabled={notificationsBusy}>
              {primaryButtonLabel}
            </DSButton>
            <DSButton
              preset="secondary"
              onPress={() => {
                setNotificationsMessage("Notifications skipped. You can enable them later in Settings.");
                void setStage("done");
              }}
              disabled={notificationsBusy}
            >
              Not now
            </DSButton>
            {notificationsMessage ? <Text style={s.styles.mutedText}>{notificationsMessage}</Text> : null}
          </View>
        ) : null}

        {s.auth.status === "authenticating" ? (
          <View style={s.styles.statusRail}>
            <Text style={s.styles.statusRailTitle}>Signing in</Text>
            <Text style={s.styles.statusRailItem}>Waiting for secure login to complete...</Text>
          </View>
        ) : null}

        {s.auth.status === "error" && (onboardingStage === "auth" || onboardingStage === "done") ? (
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
