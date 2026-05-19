import { useEffect, useRef, useState, type ReactElement } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TransientNotice } from "@crewcue/platform-client";
import { useDSTheme } from "../design-system";
import { appNoticeBus } from "./runtime";

const AUTO_DISMISS_MS = 4500;
const SWIPE_DISMISS_DY = -48;
const SWIPE_DISMISS_VY = -0.45;

export function TransientNoticeHost(): ReactElement | null {
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
  const [notice, setNotice] = useState<TransientNotice | undefined>(undefined);
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragY = useRef(0);

  const dismissWithAnimation = useRef(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 180, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true })
    ]).start(({ finished }) => {
      if (finished) {
        appNoticeBus.dismissTransient();
      }
    });
  }).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderGrant: () => {
        if (dismissTimer.current) {
          clearTimeout(dismissTimer.current);
          dismissTimer.current = undefined;
        }
      },
      onPanResponderMove: (_, gesture) => {
        const dy = Math.min(0, gesture.dy);
        dragY.current = dy;
        translateY.setValue(dy);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy <= SWIPE_DISMISS_DY || gesture.vy <= SWIPE_DISMISS_VY) {
          dismissWithAnimation();
          return;
        }
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 9 }).start();
        dismissTimer.current = setTimeout(() => {
          appNoticeBus.dismissTransient();
        }, AUTO_DISMISS_MS);
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 9 }).start();
      }
    })
  ).current;

  useEffect(() => {
    return appNoticeBus.subscribe((state) => {
      setNotice(state.transient);
    });
  }, []);

  useEffect(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = undefined;
    }

    if (!notice) {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -120, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true })
      ]).start();
      return;
    }

    dragY.current = 0;
    translateY.setValue(-120);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 9 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true })
    ]).start();

    dismissTimer.current = setTimeout(() => {
      dismissWithAnimation();
    }, AUTO_DISMISS_MS);

    return () => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
      }
    };
  }, [notice, opacity, translateY, dismissWithAnimation]);

  if (!notice) {
    return null;
  }

  return (
    <View style={[styles.host, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
      <Animated.View style={{ opacity, transform: [{ translateY }] }} {...panResponder.panHandlers}>
        <Pressable
          onPress={() => dismissWithAnimation()}
          style={[
            styles.banner,
            {
              backgroundColor: theme.color.card,
              borderColor: theme.color.border,
              shadowColor: theme.color.text
            }
          ]}
          accessibilityRole="alert"
        >
          <Text style={[styles.title, { color: theme.color.text }]}>CrewCue</Text>
          <Text style={[styles.body, { color: theme.color.text }]}>{notice.message}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: 12,
    alignItems: "stretch"
  },
  banner: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
    opacity: 0.7
  },
  body: {
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 20
  }
});
