import { DarkTheme, type Theme } from "@react-navigation/native";
import { CANVAS_BACKGROUND_COLOR } from "../design-system/theme";

export const navColors = {
  primary: "#6B46C1",
  background: CANVAS_BACKGROUND_COLOR,
  card: "#f7f2e9",
  text: "#111827",
  border: "#d8d1c4",
  notification: "#6B46C1",
  muted: "#7a756c"
} as const;

export const crewCueNavigationTheme: Theme = {
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
};
