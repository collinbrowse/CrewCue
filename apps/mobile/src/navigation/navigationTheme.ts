import { DarkTheme, type Theme } from "@react-navigation/native";
import { useMemo } from "react";
import { useDSTheme } from "../design-system/theme";

export type NavColors = {
  primary: string;
  background: string;
  card: string;
  text: string;
  border: string;
  notification: string;
  muted: string;
};

export function useNavColors(): NavColors {
  const theme = useDSTheme();
  return useMemo(
    () => ({
      primary: theme.color.primary,
      background: theme.color.background,
      card: theme.color.card,
      text: theme.color.text,
      border: theme.color.border,
      notification: theme.color.notification,
      muted: theme.color.muted
    }),
    [theme]
  );
}

export function useCrewCueNavigationTheme(): Theme {
  const navColors = useNavColors();
  return useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        primary: navColors.primary,
        background: navColors.background,
        card: navColors.card,
        text: navColors.text,
        border: navColors.border,
        notification: navColors.notification
      }
    }),
    [navColors]
  );
}
