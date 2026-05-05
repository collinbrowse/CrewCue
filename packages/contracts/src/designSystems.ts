export type DesignSystemId = "kinetic" | "performance";
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

export const DEFAULT_DESIGN_SYSTEM_ID: DesignSystemId = "kinetic";

export const DESIGN_SYSTEMS: Record<DesignSystemId, DesignSystemDefinition> = {
  kinetic: {
    id: "kinetic",
    name: "Kinetic",
    variants: {
      light: {
        colors: {
          surface: "#fcf9f8",
          surfaceDim: "#dcd9d9",
          surfaceBright: "#fcf9f8",
          surfaceContainerLowest: "#ffffff",
          surfaceContainerLow: "#f6f3f2",
          surfaceContainer: "#f0edec",
          surfaceContainerHigh: "#ebe7e7",
          surfaceContainerHighest: "#e5e2e1",
          onSurface: "#1c1b1b",
          onSurfaceVariant: "#444933",
          inverseSurface: "#313030",
          inverseOnSurface: "#f3f0ef",
          outline: "#747a60",
          outlineVariant: "#c4c9ac",
          surfaceTint: "#506600",
          primary: "#506600",
          onPrimary: "#ffffff",
          primaryContainer: "#ccff00",
          onPrimaryContainer: "#5b7300",
          inversePrimary: "#abd600",
          secondary: "#a33800",
          onSecondary: "#ffffff",
          secondaryContainer: "#cd4800",
          onSecondaryContainer: "#fffbff",
          tertiary: "#006877",
          onTertiary: "#ffffff",
          tertiaryContainer: "#c8f4ff",
          onTertiaryContainer: "#007586",
          error: "#ba1a1a",
          onError: "#ffffff",
          errorContainer: "#ffdad6",
          onErrorContainer: "#93000a",
          background: "#fcf9f8",
          onBackground: "#1c1b1b",
          surfaceVariant: "#e5e2e1"
        },
        typography: {
          display: {
            fontFamily: "Lexend, system-ui, sans-serif",
            fontSizePx: 48,
            fontWeight: "800",
            lineHeight: "1.1",
            letterSpacing: "-0.02em"
          },
          headline: {
            fontFamily: "Lexend, system-ui, sans-serif",
            fontSizePx: 32,
            fontWeight: "700",
            lineHeight: "1.2"
          },
          dataPoint: {
            fontFamily: "Space Grotesk, Inter, system-ui, sans-serif",
            fontSizePx: 28,
            fontWeight: "700",
            lineHeight: "1",
            letterSpacing: "0.05em"
          },
          bodyMd: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 16,
            fontWeight: "400",
            lineHeight: "1.5"
          },
          labelCaps: {
            fontFamily: "Space Grotesk, Inter, system-ui, sans-serif",
            fontSizePx: 12,
            fontWeight: "600",
            lineHeight: "1",
            letterSpacing: "0.1em"
          },
          buttonText: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 16,
            fontWeight: "600",
            lineHeight: "1"
          }
        },
        radius: {
          sm: 2,
          default: 4,
          md: 6,
          lg: 8,
          xl: 12,
          full: 9999
        },
        spacing: {
          base: 8,
          touchTargetMin: 48,
          marginEdge: 20,
          gutter: 12,
          cardPadding: 16,
          stackSm: 12,
          stackMd: 16,
          stackLg: 24
        }
      },
      dark: {
        colors: {
          surface: "#131313",
          surfaceDim: "#131313",
          surfaceBright: "#393939",
          surfaceContainerLowest: "#0e0e0e",
          surfaceContainerLow: "#1c1b1b",
          surfaceContainer: "#201f1f",
          surfaceContainerHigh: "#2a2a2a",
          surfaceContainerHighest: "#353534",
          onSurface: "#e5e2e1",
          onSurfaceVariant: "#c4c9ac",
          inverseSurface: "#e5e2e1",
          inverseOnSurface: "#313030",
          outline: "#8e9379",
          outlineVariant: "#444933",
          surfaceTint: "#abd600",
          primary: "#ffffff",
          onPrimary: "#283500",
          primaryContainer: "#c3f400",
          onPrimaryContainer: "#556d00",
          inversePrimary: "#506600",
          secondary: "#ffb59a",
          onSecondary: "#5a1b00",
          secondaryContainer: "#ff5e07",
          onSecondaryContainer: "#531900",
          tertiary: "#ffffff",
          onTertiary: "#00363f",
          tertiaryContainer: "#a5eeff",
          onTertiaryContainer: "#006f7f",
          error: "#ffb4ab",
          onError: "#690005",
          errorContainer: "#93000a",
          onErrorContainer: "#ffdad6",
          background: "#131313",
          onBackground: "#e5e2e1",
          surfaceVariant: "#353534"
        },
        typography: {
          display: {
            fontFamily: "Lexend, system-ui, sans-serif",
            fontSizePx: 48,
            fontWeight: "800",
            lineHeight: "1.1",
            letterSpacing: "-0.02em"
          },
          headline: {
            fontFamily: "Lexend, system-ui, sans-serif",
            fontSizePx: 32,
            fontWeight: "700",
            lineHeight: "1.2"
          },
          dataPoint: {
            fontFamily: "Space Grotesk, Inter, system-ui, sans-serif",
            fontSizePx: 28,
            fontWeight: "700",
            lineHeight: "1",
            letterSpacing: "0.05em"
          },
          bodyMd: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 16,
            fontWeight: "400",
            lineHeight: "1.5"
          },
          labelCaps: {
            fontFamily: "Space Grotesk, Inter, system-ui, sans-serif",
            fontSizePx: 12,
            fontWeight: "600",
            lineHeight: "1",
            letterSpacing: "0.1em"
          },
          buttonText: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSizePx: 16,
            fontWeight: "600",
            lineHeight: "1"
          }
        },
        radius: {
          sm: 2,
          default: 4,
          md: 6,
          lg: 8,
          xl: 12,
          full: 9999
        },
        spacing: {
          base: 8,
          touchTargetMin: 48,
          marginEdge: 20,
          gutter: 12,
          cardPadding: 16,
          stackSm: 12,
          stackMd: 16,
          stackLg: 24
        }
      }
    }
  },
  performance: {
    id: "performance",
    name: "Performance",
    variants: {
      light: {
        colors: {
          surface: "#fcf9f0",
          surfaceDim: "#dddad1",
          surfaceBright: "#fcf9f0",
          surfaceContainerLowest: "#ffffff",
          surfaceContainerLow: "#f6f3ea",
          surfaceContainer: "#f1eee5",
          surfaceContainerHigh: "#ebe8df",
          surfaceContainerHighest: "#e5e2da",
          onSurface: "#1c1c17",
          onSurfaceVariant: "#484553",
          inverseSurface: "#31312b",
          inverseOnSurface: "#f4f1e8",
          outline: "#797584",
          outlineVariant: "#c9c4d5",
          surfaceTint: "#5e4ac3",
          primary: "#5440b9",
          onPrimary: "#ffffff",
          primaryContainer: "#6d5ad3",
          onPrimaryContainer: "#f3edff",
          inversePrimary: "#c9bfff",
          secondary: "#0058be",
          onSecondary: "#ffffff",
          secondaryContainer: "#2170e4",
          onSecondaryContainer: "#fefcff",
          tertiary: "#4e5566",
          onTertiary: "#ffffff",
          tertiaryContainer: "#666d7f",
          onTertiaryContainer: "#ecf0ff",
          error: "#ba1a1a",
          onError: "#ffffff",
          errorContainer: "#ffdad6",
          onErrorContainer: "#93000a",
          background: "#fcf9f0",
          onBackground: "#1c1c17",
          surfaceVariant: "#e5e2da"
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
          surface: "#14140f",
          surfaceDim: "#14140f",
          surfaceBright: "#3a3933",
          surfaceContainerLowest: "#0e0e0a",
          surfaceContainerLow: "#1c1c17",
          surfaceContainer: "#20201b",
          surfaceContainerHigh: "#2a2a25",
          surfaceContainerHighest: "#35352f",
          onSurface: "#e5e2da",
          onSurfaceVariant: "#c9c4d5",
          inverseSurface: "#e5e2da",
          inverseOnSurface: "#31312b",
          outline: "#938e9f",
          outlineVariant: "#484553",
          surfaceTint: "#c9bfff",
          primary: "#c9bfff",
          onPrimary: "#2f0c94",
          primaryContainer: "#6d5ad3",
          onPrimaryContainer: "#f3edff",
          inversePrimary: "#5e4ac3",
          secondary: "#adc6ff",
          onSecondary: "#002e6a",
          secondaryContainer: "#0566d9",
          onSecondaryContainer: "#e6ecff",
          tertiary: "#c0c6db",
          onTertiary: "#293040",
          tertiaryContainer: "#666d7f",
          onTertiaryContainer: "#ecf0ff",
          error: "#ffb4ab",
          onError: "#690005",
          errorContainer: "#93000a",
          onErrorContainer: "#ffdad6",
          background: "#14140f",
          onBackground: "#e5e2da",
          surfaceVariant: "#35352f"
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
