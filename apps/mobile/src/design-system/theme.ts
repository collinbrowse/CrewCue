import { useColorScheme } from "react-native";

/** App-wide canvas behind navigators and full-bleed screens. Toggle once here — wired to `color.background` in both schemes and React Navigation `colors.background`. */
export const CANVAS_BACKGROUND_COLOR = "#f3efe6";

export type DSThemeTokens = {
  color: {
    primary: string;
    background: string;
    card: string;
    text: string;
    border: string;
    muted: string;
    body: string;
    success: string;
    warning: string;
    danger: string;
    secondaryButton: string;
    secondaryButtonActiveBorder: string;
    toggleButton: string;
    summaryCard: string;
    statusRail: string;
    visitBorder: string;
    divider: string;
    notification: string;
  };
};

const darkTokens: DSThemeTokens = {
  color: {
    primary: "#2563eb",
    background: CANVAS_BACKGROUND_COLOR,
    card: "#111827",
    text: "#f9fafb",
    border: "#1f2937",
    muted: "#9ca3af",
    body: "#d1d5db",
    success: "#86efac",
    warning: "#fde68a",
    danger: "#fca5a5",
    secondaryButton: "#1f2937",
    secondaryButtonActiveBorder: "#3b82f6",
    toggleButton: "#374151",
    summaryCard: "#0b1220",
    statusRail: "#0b1220",
    visitBorder: "#374151",
    divider: "#1f2937",
    notification: "#3b82f6"
  }
};

const lightTokens: DSThemeTokens = {
  color: {
    primary: "#2563eb",
    background: CANVAS_BACKGROUND_COLOR,
    card: "#ffffff",
    text: "#0f172a",
    border: "#cbd5e1",
    muted: "#64748b",
    body: "#334155",
    success: "#15803d",
    warning: "#b45309",
    danger: "#b91c1c",
    secondaryButton: "#e2e8f0",
    secondaryButtonActiveBorder: "#2563eb",
    toggleButton: "#cbd5e1",
    summaryCard: "#f1f5f9",
    statusRail: "#f1f5f9",
    visitBorder: "#94a3b8",
    divider: "#cbd5e1",
    notification: "#2563eb"
  }
};

export function useDSTheme(): DSThemeTokens {
  const scheme = useColorScheme();
  return scheme === "light" ? lightTokens : darkTokens;
}

