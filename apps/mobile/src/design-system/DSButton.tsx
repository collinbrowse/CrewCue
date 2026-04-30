import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useDSTheme } from "./theme";

export type DSButtonPreset = "primary" | "secondary" | "danger";

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
      : preset === "danger"
        ? theme.color.danger
        : theme.color.secondaryButton;

  const textColor = theme.color.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.base,
        { backgroundColor, opacity: disabled ? 0.6 : 1 },
        fullWidth ? styles.fullWidth : null
      ]}
    >
      <Text style={[styles.label, { color: textColor }]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center"
  },
  label: {
    fontSize: 14,
    fontWeight: "600"
  },
  fullWidth: {
    width: "100%"
  }
});

