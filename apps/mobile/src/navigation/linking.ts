import type { LinkingOptions } from "@react-navigation/native";
import { getStateFromPath } from "@react-navigation/native";
import { Linking } from "react-native";
import {
  CREW_CUE_LINKING_PREFIXES,
  isAuthedTabDeepLinkPath,
  pathFromCrewCueUrl
} from "./linkingPaths";
import { isStravaOAuthDeepLink } from "../features/strava/stravaOAuth";

export { CREW_CUE_LINKING_PREFIXES, isAuthedTabDeepLinkPath, pathFromCrewCueUrl } from "./linkingPaths";

import { authedTabLinkingScreens, guestLinkingScreens } from "./linkingConfig";

export { authedTabLinkingScreens, guestLinkingScreens } from "./linkingConfig";

/** @deprecated Use `buildCrewCueLinking` — kept for imports that expect a static config object. */
export const crewCueLinking: LinkingOptions<any> = buildCrewCueLinking({ showAuthedTabs: true });

export function navigationStateForAuthedDeepLink(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return getStateFromPath(normalized, { screens: authedTabLinkingScreens });
}

export type BuildCrewCueLinkingOptions = {
  showAuthedTabs: boolean;
  /** Called when an authed-tab URL arrives while guest/onboarding root is active. */
  onDeferAuthedDeepLink?: (url: string) => void;
  /** Latest `showAuthedTabs` for URL subscription (avoids stale closure). */
  showAuthedTabsRef?: { current: boolean };
};

export function buildCrewCueLinking(options: BuildCrewCueLinkingOptions): LinkingOptions<any> {
  const { showAuthedTabs, onDeferAuthedDeepLink, showAuthedTabsRef } = options;
  const screens = showAuthedTabs ? authedTabLinkingScreens : guestLinkingScreens;

  const shouldDeferAuthedUrl = (url: string): boolean => {
    const path = pathFromCrewCueUrl(url);
    if (!path || !isAuthedTabDeepLinkPath(path)) return false;
    const authed = showAuthedTabsRef?.current ?? showAuthedTabs;
    return !authed;
  };

  return {
    prefixes: [...CREW_CUE_LINKING_PREFIXES],
    config: { screens },
    async getInitialURL() {
      const url = await Linking.getInitialURL();
      if (!url) return undefined;
      if (isStravaOAuthDeepLink(url)) return undefined;
      if (shouldDeferAuthedUrl(url)) {
        onDeferAuthedDeepLink?.(url);
        return undefined;
      }
      return url;
    },
    subscribe(listener) {
      const onReceive = ({ url }: { url: string }) => {
        if (isStravaOAuthDeepLink(url)) return;
        if (shouldDeferAuthedUrl(url)) {
          onDeferAuthedDeepLink?.(url);
          return;
        }
        listener(url);
      };
      const subscription = Linking.addEventListener("url", onReceive);
      return () => subscription.remove();
    }
  };
}
