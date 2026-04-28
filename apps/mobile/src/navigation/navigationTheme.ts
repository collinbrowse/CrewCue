import { DarkTheme, type Theme } from "@react-navigation/native";

export const navColors = {
  primary: "#2563eb",
  background: "#0f172a",
  card: "#111827",
  text: "#f9fafb",
  border: "#1f2937",
  notification: "#3b82f6",
  muted: "#9ca3af"
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
