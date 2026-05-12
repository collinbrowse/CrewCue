import type { ReactElement } from "react";
import { useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import type { DSThemeTokens } from "../../design-system";

const RAIL_WIDTH = 28;
const LINE_W = 2;
const DOT_CURRENT = 22;
const DOT_DEFAULT = 18;
const PAD_Y = 8;
/** Upper bound for dot + border so travel math stays stable across active/inactive sizes. */
const DOT_SLOT = DOT_CURRENT + 6;

type Props = {
  theme: DSThemeTokens;
  /** Active leg: purple trunk; otherwise gray. */
  isActiveLeg: boolean;
  /** Completed checkpoint: filled dot + check; marker pins to bottom. */
  completed: boolean;
  /** Target 0–1 along the rail (live leg, resting top/bottom when inactive, or 1 when completed). */
  fraction01: number;
  /** Finish row uses a flag icon instead of empty/check. */
  variant?: "checkpoint" | "finish";
};

export function PaceTimelineRail({ theme, isActiveLeg, completed, fraction01, variant = "checkpoint" }: Props): ReactElement {
  const { color } = theme;
  const lineColor = isActiveLeg ? color.primary : color.divider;
  const trackH = useSharedValue(72);
  const fr = useSharedValue(0);

  const maxTravel = useDerivedValue(() => Math.max(0, trackH.value - PAD_Y * 2 - DOT_SLOT));

  useEffect(() => {
    if (completed) {
      fr.value = withTiming(1, { duration: 260 });
    } else if (isActiveLeg) {
      fr.value = withSpring(fraction01, { damping: 22, stiffness: 180, mass: 0.35 });
    } else {
      fr.value = withTiming(fraction01, { duration: 280 });
    }
  }, [fraction01, isActiveLeg, completed, fr]);

  const dotSize = isActiveLeg && !completed ? DOT_CURRENT : DOT_DEFAULT;
  const borderW = isActiveLeg && !completed ? 3 : 2;
  const dotFill = completed ? color.primary : color.card;

  const dotAnimated = useAnimatedStyle(() => ({
    transform: [{ translateY: fr.value * maxTravel.value }]
  }));

  const lineLeft = (RAIL_WIDTH - LINE_W) / 2;

  return (
    <View
      style={styles.railColumn}
      onLayout={(e) => {
        trackH.value = e.nativeEvent.layout.height;
      }}
    >
      <View style={[styles.line, { left: lineLeft, top: PAD_Y, bottom: PAD_Y, backgroundColor: lineColor }]} />
      <Animated.View
        style={[
          {
            position: "absolute",
            top: PAD_Y,
            left: (RAIL_WIDTH - dotSize) / 2,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            borderWidth: borderW,
            borderColor: color.primary,
            backgroundColor: dotFill,
            alignItems: "center",
            justifyContent: "center"
          },
          dotAnimated
        ]}
      >
        {completed ? (
          <Ionicons name="checkmark" size={11} color={color.authPrimaryActionText} />
        ) : variant === "finish" ? (
          <Ionicons name="flag" size={12} color={color.primary} />
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  railColumn: {
    width: RAIL_WIDTH,
    alignSelf: "stretch",
    position: "relative",
    minHeight: 48
  },
  line: {
    position: "absolute",
    width: LINE_W,
    borderRadius: 1
  }
});
