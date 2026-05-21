import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useDSTheme } from "./theme";

export type DSButtonPreset = "primary" | "secondary" | "danger" | "authPrimary" | "authSecondary" | "authOutline";

type Props = {
  preset?: DSButtonPreset;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
  fullWidth?: boolean;
};

export function DSButton({
  preset = "secondary",
  disabled = false,
  onPress,
  children,
  fullWidth = false
}: Props): ReactElement {
  const theme = useDSTheme();

  const backgroundColor =
    preset === "primary"
      ? theme.color.primary
      : preset === "authPrimary"
        ? theme.color.authPrimaryAction
        : preset === "authSecondary"
          ? theme.color.authSecondaryAction
          : preset === "authOutline"
            ? "transparent"
      : preset === "danger"
        ? theme.color.danger
        : theme.color.secondaryButton;

  const textColor =
    preset === "primary"
      ? theme.color.onPrimary
      : preset === "authPrimary"
      ? theme.color.authPrimaryActionText
      : preset === "authSecondary"
        ? theme.color.authSecondaryActionText
        : preset === "authOutline"
          ? theme.color.authOutlineText
          : theme.color.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.base,
        preset === "authPrimary" || preset === "authSecondary" || preset === "authOutline"
          ? styles.authBase
          : null,
        preset === "authOutline"
          ? { borderWidth: 2, borderColor: theme.color.authOutlineBorder }
          : null,
        {
          backgroundColor,
          borderRadius: theme.radius.md,
          minHeight: theme.spacing.touchTargetMin,
          opacity: disabled ? 0.6 : 1
        },
        fullWidth ? styles.fullWidth : null
      ]}
    >
      <Text
        style={[
          styles.label,
          preset === "authPrimary" || preset === "authSecondary" || preset === "authOutline"
            ? styles.authLabel
            : null,
          { color: textColor }
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  authBase: {
    minHeight: 48,
    borderRadius: 24,
    justifyContent: "center"
  },
  label: {
    fontSize: 14,
    fontWeight: "600"
  },
  authLabel: {
    fontSize: 17,
    fontWeight: "700"
  },
  fullWidth: {
    width: "100%"
  }
});

