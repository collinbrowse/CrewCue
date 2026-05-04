import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import * as AppleAuthentication from "expo-apple-authentication";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import type { ViewStyle } from "react-native";
import { Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

/** Same vertical size as `AppleAuthenticationButton` height and Email `minHeight` on auth screens. */
const IDP_ROW_HEIGHT = 48;

/** Dark-theme fill behind raster (PNG assets include the official 1px #8E918F stroke). */
const GOOGLE_DARK_FILL = "#131314";

/** Pill radius for guest landing IdP rows. */
const GUEST_LANDING_RADIUS = 24;

/** Cap IdP column width on tablet + web so buttons stay readable (GIS commonly uses ≤ ~400 logical px wide). */
export const AUTH_IDP_COLUMN_MAX_WIDTH = 400;
const TABLET_MIN_BREAKPOINT = 768;

/**
 * Constrains stacked IdP buttons on wide layouts so web/tablet do not stretch edge-to-edge.
 * Phones use full width of the parent (typically screen minus padding).
 */
export function useAuthIdpColumnConstraints(): ViewStyle {
  const { width } = useWindowDimensions();
  const wideLayout = Platform.OS === "web" || width >= TABLET_MIN_BREAKPOINT;
  if (!wideLayout) return {};
  return {
    alignSelf: "center",
    width: "100%",
    maxWidth: AUTH_IDP_COLUMN_MAX_WIDTH
  };
}

/** Matches onboarding copy: sign-in uses “Continue …”, signup uses “Sign up …”. */
export type IdpAuthFlow = "signin" | "signup";

export type IdpAuthSurface = "default" | "guestLanding";

type CommonProps = {
  flow: IdpAuthFlow;
  onPress: () => void;
  surface?: IdpAuthSurface;
};

/**
 * Guest landing: custom black pill + icon + label (matches Apple fallback chrome). Avoids GIS raster inner frame.
 * Default: Google-approved dark-theme PNG rows (`JoinCrewAccountScreen`, etc.).
 */
export function GoogleAuthMarkButton({
  flow,
  onPress,
  surface = "default"
}: CommonProps): ReactElement {
  const source =
    flow === "signup"
      ? require("../../../assets/idp/google/google_signup_dark.png")
      : require("../../../assets/idp/google/google_continue_dark.png");
  const label = flow === "signup" ? "Sign up with Google" : "Continue with Google";

  const guest = surface === "guestLanding";

  if (guest) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [
          styles.googleTap,
          styles.appleFallbackOuterGuestLanding,
          pressed && styles.pressed
        ]}
      >
        <View style={styles.appleFallbackInner}>
          <Image
            accessibilityIgnoresInvertColors
            accessible={false}
            resizeMode="contain"
            source={require("../../../assets/idp/google/googleg_48dp.png")}
            style={styles.googleGuestMark}
          />
          <Text style={styles.appleFallbackTextGuestLanding}>{label}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.googleTap, pressed && styles.pressed]}
    >
      <View style={styles.googleChrome}>
        <Image
          accessibilityIgnoresInvertColors
          accessible={false}
          source={source}
          style={styles.googleImage}
          resizeMode="contain"
        />
      </View>
    </Pressable>
  );
}

/**
 * Native `AppleAuthenticationButton` only renders when the host binary includes
 * `expo-apple-authentication` (custom dev client / release). Expo Go omits it → red
 * “Unimplemented component” if we mount the native view anyway.
 *
 * When unavailable, use the same white fallback row as Android/Web (tap still opens Auth0).
 */
export function AppleAuthMarkButton({
  flow,
  onPress,
  surface = "default"
}: CommonProps): ReactElement {
  const label = flow === "signup" ? "Sign up with Apple" : "Continue with Apple";
  const guest = surface === "guestLanding";

  const [useNativeIosChrome, setUseNativeIosChrome] = useState<boolean | null>(
    Platform.OS === "ios" ? null : false
  );

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let cancelled = false;
    void AppleAuthentication.isAvailableAsync().then((ok) => {
      if (!cancelled) setUseNativeIosChrome(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (Platform.OS === "ios" && useNativeIosChrome === true) {
    const nativeRadius = guest ? GUEST_LANDING_RADIUS : 8;
    const buttonStyle = guest
      ? AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
      : AppleAuthentication.AppleAuthenticationButtonStyle.WHITE;
    return (
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={
          flow === "signup"
            ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
            : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
        }
        buttonStyle={buttonStyle}
        cornerRadius={nativeRadius}
        style={[styles.appleNative, guest ? styles.appleNativeGuestLanding : null]}
        onPress={onPress}
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        guest ? styles.appleFallbackOuterGuestLanding : styles.appleFallbackOuter,
        pressed && styles.pressed
      ]}
    >
      <View style={styles.appleFallbackInner}>
        <MaterialCommunityIcons
          accessible={false}
          name="apple"
          size={22}
          color={guest ? "#FFFFFF" : "#000000"}
        />
        <Text style={guest ? styles.appleFallbackTextGuestLanding : styles.appleFallbackText}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.88 },
  googleTap: {
    width: "100%",
    alignSelf: "stretch"
  },
  googleChrome: {
    alignSelf: "stretch",
    width: "100%",
    height: IDP_ROW_HEIGHT,
    borderRadius: 8,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: GOOGLE_DARK_FILL
  },
  googleImage: {
    width: "100%",
    height: "100%"
  },
  /** Official multicolor “G” from Google (`googleg_48dp.png`); do not tint or swap for generic icons. */
  googleGuestMark: {
    width: 24,
    height: 24
  },
  appleNative: {
    width: "100%",
    height: IDP_ROW_HEIGHT
  },
  appleNativeGuestLanding: {
    borderRadius: GUEST_LANDING_RADIUS
  },
  appleFallbackOuter: {
    width: "100%",
    alignSelf: "stretch",
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d1d5db",
    minHeight: IDP_ROW_HEIGHT,
    justifyContent: "center"
  },
  appleFallbackOuterGuestLanding: {
    width: "100%",
    alignSelf: "stretch",
    borderRadius: GUEST_LANDING_RADIUS,
    backgroundColor: "#000000",
    minHeight: IDP_ROW_HEIGHT,
    justifyContent: "center"
  },
  appleFallbackInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16
  },
  appleFallbackText: {
    color: "#000000",
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.3
  },
  appleFallbackTextGuestLanding: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.3
  }
});
