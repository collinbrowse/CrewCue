export type DesignSystemId = "ember";
export type DesignSystemMode = "light" | "dark";

export type DesignSystemDefinition = {
  id: DesignSystemId;
  name: string;
  variants: Record<DesignSystemMode, DesignSystemVariant>;
};

export type DesignSystemVariant = {
  colors: {
    surface: string;
    surfaceDim: string;
    surfaceBright: string;
    surfaceContainerLowest: string;
    surfaceContainerLow: string;
    surfaceContainer: string;
    surfaceContainerHigh: string;
    surfaceContainerHighest: string;
    onSurface: string;
    onSurfaceVariant: string;
    inverseSurface: string;
    inverseOnSurface: string;
    outline: string;
    outlineVariant: string;
    surfaceTint: string;
    primary: string;
    onPrimary: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    inversePrimary: string;
    secondary: string;
    onSecondary: string;
    secondaryContainer: string;
    onSecondaryContainer: string;
    tertiary: string;
    onTertiary: string;
    tertiaryContainer: string;
    onTertiaryContainer: string;
    error: string;
    onError: string;
    errorContainer: string;
    onErrorContainer: string;
    background: string;
    onBackground: string;
    surfaceVariant: string;
  };
  typography: {
    display: {
      fontFamily: string;
      fontSizePx: number;
      fontWeight: "700" | "800";
      lineHeight: string;
      letterSpacing: string;
    };
    headline: {
      fontFamily: string;
      fontSizePx: number;
      fontWeight: "600" | "700";
      lineHeight: string;
    };
    dataPoint: {
      fontFamily: string;
      fontSizePx: number;
      fontWeight: "700";
      lineHeight: string;
      letterSpacing: string;
    };
    bodyMd: {
      fontFamily: string;
      fontSizePx: number;
      fontWeight: "400";
      lineHeight: string;
    };
    labelCaps: {
      fontFamily: string;
      fontSizePx: number;
      fontWeight: "600";
      lineHeight: string;
      letterSpacing: string;
    };
    buttonText: {
      fontFamily: string;
      fontSizePx: number;
      fontWeight: "600";
      lineHeight: string;
    };
  };
  radius: {
    sm: number;
    default: number;
    md: number;
    lg: number;
    xl: number;
    full: number;
  };
  spacing: {
    base: number;
    touchTargetMin: number;
    marginEdge: number;
    gutter: number;
    cardPadding: number;
    stackSm: number;
    stackMd: number;
    stackLg: number;
  };
};

export const DEFAULT_DESIGN_SYSTEM_ID: DesignSystemId = "ember";

export const DESIGN_SYSTEMS: Record<DesignSystemId, DesignSystemDefinition> = {
  ember: {
    id: "ember",
    name: "Ember",
    variants: {
      light: {
        colors: {
          surface: "#ffffff",
          surfaceDim: "#ddd7cb",
          surfaceBright: "#ffffff",
          surfaceContainerLowest: "#f8f4ea",
          surfaceContainerLow: "#f3eee3",
          surfaceContainer: "#f0eadd",
          surfaceContainerHigh: "#e9e2d3",
          surfaceContainerHighest: "#e3dccc",
          onSurface: "#1f2730",
          onSurfaceVariant: "#4a5563",
          inverseSurface: "#2a3340",
          inverseOnSurface: "#f3ecdd",
          outline: "#7a7f87",
          outlineVariant: "#d6d0c3",
          surfaceTint: "#b5441a",
          primary: "#b5441a",
          onPrimary: "#ffffff",
          primaryContainer: "#fbe3d6",
          onPrimaryContainer: "#8a3110",
          inversePrimary: "#ff8f5c",
          secondary: "#34404f",
          onSecondary: "#ffffff",
          secondaryContainer: "#e3e8ef",
          onSecondaryContainer: "#1f2730",
          tertiary: "#4e5a66",
          onTertiary: "#ffffff",
          tertiaryContainer: "#dce3ea",
          onTertiaryContainer: "#1f2730",
          error: "#ba1a1a",
          onError: "#ffffff",
          errorContainer: "#fde7e7",
          onErrorContainer: "#93000a",
          background: "#ffffff",
          onBackground: "#1f2730",
          surfaceVariant: "#e3dccc"
        },
        typography: {
          display: {
            fontFamily: "Lexend, system-ui, sans-serif",
            fontSizePx: 32,
            fontWeight: "700",
            lineHeight: "1.2",
            letterSpacing: "-0.02em"
          },
          headline: {
            fontFamily: "Lexend, system-ui, sans-serif",
            fontSizePx: 24,
            fontWeight: "600",
            lineHeight: "1.3"
          },
          dataPoint: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 24,
            fontWeight: "700",
            lineHeight: "1.1",
            letterSpacing: "0.02em"
          },
          bodyMd: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 16,
            fontWeight: "400",
            lineHeight: "1.5"
          },
          labelCaps: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 12,
            fontWeight: "600",
            lineHeight: "1",
            letterSpacing: "0.05em"
          },
          buttonText: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 16,
            fontWeight: "600",
            lineHeight: "1"
          }
        },
        radius: {
          sm: 8,
          default: 16,
          md: 24,
          lg: 32,
          xl: 48,
          full: 9999
        },
        spacing: {
          base: 8,
          touchTargetMin: 48,
          marginEdge: 24,
          gutter: 16,
          cardPadding: 24,
          stackSm: 12,
          stackMd: 24,
          stackLg: 48
        }
      },
      dark: {
        colors: {
          surface: "#161a20",
          surfaceDim: "#161a20",
          surfaceBright: "#3a424d",
          surfaceContainerLowest: "#101318",
          surfaceContainerLow: "#1b2027",
          surfaceContainer: "#1f252d",
          surfaceContainerHigh: "#283039",
          surfaceContainerHighest: "#323b45",
          onSurface: "#ece6da",
          onSurfaceVariant: "#c3c7cd",
          inverseSurface: "#ece6da",
          inverseOnSurface: "#2a3340",
          outline: "#8a929c",
          outlineVariant: "#3a434e",
          surfaceTint: "#ff8f5c",
          primary: "#ff8f5c",
          onPrimary: "#3a1404",
          primaryContainer: "#5a2510",
          onPrimaryContainer: "#ffdbcb",
          inversePrimary: "#b5441a",
          secondary: "#b7c4d4",
          onSecondary: "#1f2730",
          secondaryContainer: "#323b45",
          onSecondaryContainer: "#ece6da",
          tertiary: "#c0c8d2",
          onTertiary: "#263039",
          tertiaryContainer: "#4e5a66",
          onTertiaryContainer: "#e3e8ef",
          error: "#ffb4ab",
          onError: "#690005",
          errorContainer: "#3b1a17",
          onErrorContainer: "#ffdad6",
          background: "#161a20",
          onBackground: "#ece6da",
          surfaceVariant: "#323b45"
        },
        typography: {
          display: {
            fontFamily: "Lexend, system-ui, sans-serif",
            fontSizePx: 32,
            fontWeight: "700",
            lineHeight: "1.2",
            letterSpacing: "-0.02em"
          },
          headline: {
            fontFamily: "Lexend, system-ui, sans-serif",
            fontSizePx: 24,
            fontWeight: "600",
            lineHeight: "1.3"
          },
          dataPoint: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 24,
            fontWeight: "700",
            lineHeight: "1.1",
            letterSpacing: "0.02em"
          },
          bodyMd: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 16,
            fontWeight: "400",
            lineHeight: "1.5"
          },
          labelCaps: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 12,
            fontWeight: "600",
            lineHeight: "1",
            letterSpacing: "0.05em"
          },
          buttonText: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 16,
            fontWeight: "600",
            lineHeight: "1"
          }
        },
        radius: {
          sm: 8,
          default: 16,
          md: 24,
          lg: 32,
          xl: 48,
          full: 9999
        },
        spacing: {
          base: 8,
          touchTargetMin: 48,
          marginEdge: 24,
          gutter: 16,
          cardPadding: 24,
          stackSm: 12,
          stackMd: 24,
          stackLg: 48
        }
      }
    }
  }
};
