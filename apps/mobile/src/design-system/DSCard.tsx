import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useDSTheme } from "./theme";

type Props = {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
};

export function DSCard({ children, style }: Props): ReactElement {
  const theme = useDSTheme();
  return <View style={[styles.base, { backgroundColor: theme.color.card }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 16,
    padding: 20,
    gap: 4
  }
});

