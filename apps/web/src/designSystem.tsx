import {
  DEFAULT_DESIGN_SYSTEM_ID,
  DESIGN_SYSTEMS,
  type DesignSystemDefinition,
  type DesignSystemId
} from "@crewcue/contracts";
import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { getStoredWebDesignSystemId, setStoredWebDesignSystemId } from "./preferences/designSystemPreference";

type WebDesignSystemContextValue = {
  selectedDesignSystemId: DesignSystemId;
  setDesignSystemId: (next: DesignSystemId) => void;
  definition: DesignSystemDefinition;
};

const WebDesignSystemContext = createContext<WebDesignSystemContextValue | null>(null);

type WebDesignSystemProviderProps = {
  children: ReactNode;
};

export function WebDesignSystemProvider({ children }: WebDesignSystemProviderProps): ReactElement {
  const [selectedDesignSystemId, setSelectedDesignSystemId] = useState<DesignSystemId>(
    getStoredWebDesignSystemId
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-design-system", selectedDesignSystemId);
  }, [selectedDesignSystemId]);

  const value = useMemo<WebDesignSystemContextValue>(
    () => ({
      selectedDesignSystemId,
      definition: DESIGN_SYSTEMS[selectedDesignSystemId],
      setDesignSystemId: (next: DesignSystemId) => {
        setSelectedDesignSystemId(next);
        setStoredWebDesignSystemId(next);
      }
    }),
    [selectedDesignSystemId]
  );

  return <WebDesignSystemContext.Provider value={value}>{children}</WebDesignSystemContext.Provider>;
}

export function useWebDesignSystem(): WebDesignSystemContextValue {
  const value = useContext(WebDesignSystemContext);
  if (!value) {
    throw new Error("useWebDesignSystem must be used within WebDesignSystemProvider.");
  }
  return value;
}

export function getDefaultWebDesignSystemId(): DesignSystemId {
  return DEFAULT_DESIGN_SYSTEM_ID;
}
