import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthedShell } from "../shell/AuthedShellContext";
import { ONBOARDING_STAGE_KEY, type OnboardingStage } from "./onboardingState";
const ONBOARDING_SPLASH_MS = 1400;

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
  const insets = useSafeAreaInsets();
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
        if (
          storedStage === "product" ||
          storedStage === "auth" ||
          storedStage === "signupAuth" ||
          storedStage === "notifications" ||
          storedStage === "done"
        ) {
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

  useEffect(() => {
    if (s.auth.status !== "authenticated" || onboardingStage !== "signupAuth") {
      return;
    }
    void setStage("notifications");
  }, [onboardingStage, s.auth.status]);

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
        return "Connecting to Auth0...";
      }
      return "Sign Up";
    }
    if (onboardingStage === "signupAuth") {
      return "Finishing account setup...";
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
    await s.onRefreshOnboardingStage();
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

    if (onboardingStage === "done") {
      void s.auth.signIn();
      return;
    }

    if (onboardingStage === "notifications") {
      void handleEnableNotifications();
    }
  };

  const renderSplash = () => (
    <View style={styles.stageScreen}>
      <View style={[styles.orb, styles.orbTop]} />
      <View style={[styles.orb, styles.orbBottom]} />
      <View style={styles.contentWrap}>
        <Text style={styles.brandTitle}>CrewCue</Text>
        <Text style={styles.brandTagline}>Race-day command for athletes and crew</Text>
        <View style={styles.loadingPill}>
          <Text style={styles.loadingText}>Preparing your workspace...</Text>
        </View>
      </View>
    </View>
  );

  const renderProduct = () => (
    <View style={styles.stageScreen}>
      <View style={styles.contentWrap}>
        <Text style={styles.stageKicker}>Welcome to CrewCue</Text>
        <Text style={styles.stageTitle}>{currentProductStep.title}</Text>
        <Text style={styles.stageBodyText}>{currentProductStep.body}</Text>
        <View style={styles.dotRow}>
          {PRODUCT_STEPS.map((_, index) => (
            <View key={`dot-${index}`} style={[styles.dot, productIndex === index ? styles.dotActive : null]} />
          ))}
        </View>
      </View>
      <View style={styles.actionWrap}>
        <ActionButton label={primaryButtonLabel} onPress={handlePrimaryPress} />
        <ActionButton label="Sign in now" onPress={() => void setStage("auth")} variant="ghost" />
      </View>
    </View>
  );

  const renderAuth = () => (
    <View style={styles.stageScreen}>
      <View style={styles.contentWrap}>
        <Text style={styles.stageKicker}>Secure sign-in</Text>
        <Text style={styles.stageTitle}>Welcome back</Text>
        <Text style={styles.stageBodyText}>
          Sign in with your CrewCue account to continue where you left off and keep race operations synchronized.
        </Text>
        {s.auth.status === "error" ? (
          <Text style={styles.errorText}>{toUserFriendlyAuthErrorMessage(s.auth.error)}</Text>
        ) : null}
      </View>
      <View style={styles.actionWrap}>
        <ActionButton
          label={primaryButtonLabel}
          onPress={() => {
            void setStage("signupAuth").then(() => s.auth.signUp());
          }}
          disabled={s.auth.status === "authenticating" || !stageReady}
        />
        <ActionButton
          label="I already have an account"
          onPress={() => {
            void s.auth.signIn();
          }}
          variant="ghost"
        />
      </View>
    </View>
  );

  const renderNotifications = () => (
    <View style={styles.stageScreen}>
      <View style={styles.contentWrap}>
        <Text style={styles.stageKicker}>Stay in sync</Text>
        <Text style={styles.stageTitle}>Enable notifications</Text>
        <Text style={styles.stageBodyText}>
          Get important alerts for assignments, incidents, and pace changes so your crew can react quickly.
        </Text>
        {notificationsMessage ? <Text style={styles.infoText}>{notificationsMessage}</Text> : null}
      </View>
      <View style={styles.actionWrap}>
        <ActionButton label={primaryButtonLabel} onPress={handlePrimaryPress} disabled={notificationsBusy} />
        <ActionButton
          label="Not now"
          onPress={() => {
            setNotificationsMessage("You can enable notifications later in Settings.");
            void setStage("done");
          }}
          variant="ghost"
        />
      </View>
    </View>
  );

  return (
    <View
      style={[
        styles.root,
        onboardingStage === "splash"
          ? styles.splashBackground
          : onboardingStage === "product"
            ? styles.productBackground
            : onboardingStage === "notifications"
              ? styles.notificationsBackground
              : styles.authBackground
      ]}
    >
      <View style={[styles.stageContainer, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        {onboardingStage === "splash" ? renderSplash() : null}
        {onboardingStage === "product" ? renderProduct() : null}
        {onboardingStage === "auth" || onboardingStage === "done" || onboardingStage === "signupAuth"
          ? renderAuth()
          : null}
        {onboardingStage === "notifications" ? renderNotifications() : null}
      </View>
    </View>
  );
}

function toUserFriendlyAuthErrorMessage(errorText?: string): string {
  if (!errorText) {
    return "We could not complete sign-in. Please try again.";
  }

  const normalized = errorText.toLowerCase();
  if (
    normalized.includes("invalid authorization code") ||
    normalized.includes("authorization grant") ||
    normalized.includes("redirect uri")
  ) {
    return "Your sign-in session expired before it finished. Tap \"Try sign-in again\" to start a fresh sign-in.";
  }

  return "We could not complete sign-in. Please try again.";
}

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
};

function ActionButton({ label, onPress, disabled = false, variant = "primary" }: ActionButtonProps): ReactElement {
  const ghost = variant === "ghost";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.actionButton,
        ghost ? styles.ghostActionButton : styles.primaryActionButton,
        disabled ? styles.disabledActionButton : null
      ]}
    >
      <Text style={[styles.actionButtonLabel, ghost ? styles.ghostActionLabel : styles.primaryActionLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#090f26"
  },
  stageContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "space-between"
  },
  stageScreen: {
    flex: 1,
    justifyContent: "space-between"
  },
  splashBackground: {
    backgroundColor: "#1e1b4b"
  },
  productBackground: {
    backgroundColor: "#0f766e"
  },
  authBackground: {
    backgroundColor: "#1d4ed8"
  },
  notificationsBackground: {
    backgroundColor: "#7c3aed"
  },
  orb: {
    position: "absolute",
    borderRadius: 9999,
    opacity: 0.26
  },
  orbTop: {
    width: 240,
    height: 240,
    backgroundColor: "#22d3ee",
    top: -50,
    right: -40
  },
  orbBottom: {
    width: 280,
    height: 280,
    backgroundColor: "#a78bfa",
    bottom: -120,
    left: -110
  },
  contentWrap: {
    gap: 14,
    marginTop: 16
  },
  brandTitle: {
    color: "#ffffff",
    fontSize: 46,
    fontWeight: "800",
    letterSpacing: -1
  },
  brandTagline: {
    color: "#dbeafe",
    fontSize: 18,
    lineHeight: 24
  },
  loadingPill: {
    marginTop: 16,
    alignSelf: "flex-start",
    borderRadius: 9999,
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingVertical: 10,
    paddingHorizontal: 16
  },
  loadingText: {
    color: "#eff6ff",
    fontSize: 14,
    fontWeight: "600"
  },
  stageKicker: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1
  },
  stageTitle: {
    color: "#ffffff",
    fontSize: 40,
    fontWeight: "800",
    lineHeight: 42,
    letterSpacing: -0.8
  },
  stageBodyText: {
    color: "#e0e7ff",
    fontSize: 18,
    lineHeight: 27
  },
  dotRow: {
    marginTop: 16,
    flexDirection: "row",
    gap: 8
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.4)"
  },
  dotActive: {
    width: 26,
    backgroundColor: "#ffffff"
  },
  actionWrap: {
    gap: 12,
    marginBottom: 8
  },
  actionButton: {
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 14
  },
  primaryActionButton: {
    backgroundColor: "#ffffff"
  },
  ghostActionButton: {
    backgroundColor: "rgba(255,255,255,0.17)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)"
  },
  disabledActionButton: {
    opacity: 0.55
  },
  actionButtonLabel: {
    fontSize: 18,
    fontWeight: "700"
  },
  primaryActionLabel: {
    color: "#111827"
  },
  ghostActionLabel: {
    color: "#f8fafc"
  },
  errorText: {
    color: "#fee2e2",
    backgroundColor: "rgba(153,27,27,0.35)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    overflow: "hidden"
  },
  infoText: {
    color: "#ede9fe",
    backgroundColor: "rgba(76,29,149,0.28)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    overflow: "hidden"
  }
});
