import { DarkTheme, type Theme } from "@react-navigation/native";

export const crewCueNavigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: "#2563eb",
    background: "#0f172a",
    card: "#111827",
    text: "#f9fafb",
    border: "#1f2937",
    notification: "#3b82f6"
  }
};
