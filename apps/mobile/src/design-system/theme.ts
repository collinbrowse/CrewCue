import {
  DEFAULT_DESIGN_SYSTEM_ID,
  DESIGN_SYSTEMS,
  type DesignSystemDefinition,
  type DesignSystemId,
  type DesignSystemMode
} from "@crewcue/contracts";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from "react";
import { AppState, Appearance } from "react-native";
import * as SecureStore from "../storage/secureStorage";

const DESIGN_SYSTEM_STORAGE_KEY = "crewcue.design_system_id";
const DESIGN_MODE_OVERRIDE_STORAGE_KEY = "crewcue.design_mode_override";

export type DesignModeOverride = "auto" | DesignSystemMode;

export type DSThemeTokens = {
  designSystemId: DesignSystemId;
  designSystemName: string;
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
    authHeading: string;
    authBody: string;
    authAccent: string;
    authPrimaryAction: string;
    authPrimaryActionText: string;
    authSecondaryAction: string;
    authSecondaryActionText: string;
    authOutlineBorder: string;
    authOutlineText: string;
    authErrorBg: string;
    authErrorText: string;
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

function toMobileTokens(definition: DesignSystemDefinition, mode: DesignSystemMode): DSThemeTokens {
  const c = definition.variants[mode].colors;
  const variant = definition.variants[mode];
  return {
    designSystemId: definition.id,
    designSystemName: definition.name,
    color: {
      primary: c.primaryContainer,
      background: c.background,
      card: c.surfaceContainer,
      text: c.onSurface,
      border: c.outlineVariant,
      muted: c.onSurfaceVariant,
      body: c.onSurfaceVariant,
      success: c.primaryContainer,
      warning: c.secondaryContainer,
      danger: c.error,
      secondaryButton: c.surfaceContainerHigh,
      secondaryButtonActiveBorder: c.surfaceTint,
      toggleButton: c.surfaceContainerHigh,
      summaryCard: c.surfaceContainer,
      statusRail: c.surfaceContainerLow,
      visitBorder: c.outline,
      divider: c.outlineVariant,
      notification: c.surfaceTint,
      authHeading: c.onSurface,
      authBody: c.onSurfaceVariant,
      authAccent: c.surfaceTint,
      authPrimaryAction: c.primaryContainer,
      authPrimaryActionText: c.onPrimaryContainer,
      authSecondaryAction: c.secondaryContainer,
      authSecondaryActionText: c.onSecondaryContainer,
      authOutlineBorder: c.outline,
      authOutlineText: c.onSurface,
      authErrorBg: c.errorContainer,
      authErrorText: c.onErrorContainer
    },
    radius: variant.radius,
    spacing: variant.spacing
  };
}

const TOKENS_BY_SYSTEM_AND_MODE: Record<DesignSystemId, Record<DesignSystemMode, DSThemeTokens>> = {
  kinetic: {
    light: toMobileTokens(DESIGN_SYSTEMS.kinetic, "light"),
    dark: toMobileTokens(DESIGN_SYSTEMS.kinetic, "dark")
  },
  performance: {
    light: toMobileTokens(DESIGN_SYSTEMS.performance, "light"),
    dark: toMobileTokens(DESIGN_SYSTEMS.performance, "dark")
  }
};

type DesignSystemContextValue = {
  selectedDesignSystemId: DesignSystemId;
  setDesignSystemId: (next: DesignSystemId) => Promise<void>;
  designModeOverride: DesignModeOverride;
  setDesignModeOverride: (next: DesignModeOverride) => Promise<void>;
  systemMode: DesignSystemMode;
  activeMode: DesignSystemMode;
};

const DesignSystemContext = createContext<DesignSystemContextValue | null>(null);

export function getDefaultDesignSystemId(): DesignSystemId {
  return DEFAULT_DESIGN_SYSTEM_ID;
}

export async function getStoredDesignSystemId(): Promise<DesignSystemId> {
  const raw = await SecureStore.getItemAsync(DESIGN_SYSTEM_STORAGE_KEY);
  if (raw === "kineticTrail") {
    return "kinetic";
  }
  if (raw === "dayModePerformance") {
    return "performance";
  }
  if (raw === "kinetic" || raw === "performance") {
    return raw;
  }
  return DEFAULT_DESIGN_SYSTEM_ID;
}

export async function setStoredDesignSystemId(next: DesignSystemId): Promise<void> {
  await SecureStore.setItemAsync(DESIGN_SYSTEM_STORAGE_KEY, next);
}

async function getStoredDesignModeOverride(): Promise<DesignModeOverride> {
  const raw = await SecureStore.getItemAsync(DESIGN_MODE_OVERRIDE_STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "auto") {
    return raw;
  }
  return "auto";
}

async function setStoredDesignModeOverride(next: DesignModeOverride): Promise<void> {
  await SecureStore.setItemAsync(DESIGN_MODE_OVERRIDE_STORAGE_KEY, next);
}

type DSDesignSystemProviderProps = {
  children: ReactNode;
};

export function DSDesignSystemProvider({ children }: DSDesignSystemProviderProps): ReactElement {
  const [systemMode, setSystemMode] = useState<DesignSystemMode>(
    Appearance.getColorScheme() === "dark" ? "dark" : "light"
  );
  const [selectedDesignSystemId, setSelectedDesignSystemId] = useState<DesignSystemId>(
    DEFAULT_DESIGN_SYSTEM_ID
  );
  const [designModeOverride, setDesignModeOverrideState] = useState<DesignModeOverride>("auto");

  useEffect(() => {
    const refreshSystemMode = () => {
      const nextScheme = Appearance.getColorScheme();
      setSystemMode(nextScheme === "dark" ? "dark" : "light");
    };

    void getStoredDesignSystemId().then(setSelectedDesignSystemId);
    void getStoredDesignModeOverride().then(setDesignModeOverrideState);
    const appearanceSub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemMode(colorScheme === "dark" ? "dark" : "light");
    });
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshSystemMode();
      }
    });

    return () => {
      appearanceSub.remove();
      appStateSub.remove();
    };
  }, []);

  const activeMode: DesignSystemMode = designModeOverride === "auto" ? systemMode : designModeOverride;

  const value = useMemo<DesignSystemContextValue>(
    () => ({
      selectedDesignSystemId,
      designModeOverride,
      systemMode,
      activeMode,
      setDesignSystemId: async (next: DesignSystemId) => {
        setSelectedDesignSystemId(next);
        await setStoredDesignSystemId(next);
      },
      setDesignModeOverride: async (next: DesignModeOverride) => {
        setDesignModeOverrideState(next);
        await setStoredDesignModeOverride(next);
      }
    }),
    [activeMode, designModeOverride, selectedDesignSystemId, systemMode]
  );

  return createElement(DesignSystemContext.Provider, { value }, children);
}

function useDesignSystemContext(): DesignSystemContextValue {
  const value = useContext(DesignSystemContext);
  if (!value) {
    throw new Error("useDSTheme must be used within DSDesignSystemProvider.");
  }
  return value;
}

export function useDesignSystemSelection(): DesignSystemContextValue {
  return useDesignSystemContext();
}

export function useDSTheme(): DSThemeTokens {
  const { selectedDesignSystemId, activeMode } = useDesignSystemContext();
  return TOKENS_BY_SYSTEM_AND_MODE[selectedDesignSystemId][activeMode];
}

export function currentCanvasBackground(designSystemId: DesignSystemId): string {
  return TOKENS_BY_SYSTEM_AND_MODE[designSystemId].light.color.background;
}

/** App-wide canvas behind navigators and full-bleed screens. */
export const CANVAS_BACKGROUND_COLOR =
  TOKENS_BY_SYSTEM_AND_MODE[DEFAULT_DESIGN_SYSTEM_ID].light.color.background;
