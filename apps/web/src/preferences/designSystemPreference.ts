import { DEFAULT_DESIGN_SYSTEM_ID, type DesignSystemId } from "@crewcue/contracts";

const WEB_DESIGN_SYSTEM_KEY = "crewcue.web_design_system";

export function getStoredWebDesignSystemId(): DesignSystemId {
  if (typeof window === "undefined") {
    return DEFAULT_DESIGN_SYSTEM_ID;
  }
  try {
    const raw = window.localStorage.getItem(WEB_DESIGN_SYSTEM_KEY);
    if (raw === "kineticTrail") {
      return "kinetic";
    }
    if (raw === "dayModePerformance") {
      return "performance";
    }
    if (raw === "kinetic" || raw === "performance") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_DESIGN_SYSTEM_ID;
}

export function setStoredWebDesignSystemId(next: DesignSystemId): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(WEB_DESIGN_SYSTEM_KEY, next);
  } catch {
    /* ignore */
  }
}
