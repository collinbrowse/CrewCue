export const CREW_CUE_LINKING_PREFIXES = ["crewcue://"] as const;

const AUTHED_TAB_ROOTS = new Set(["map", "course", "chat", "profile"]);

export function pathFromCrewCueUrl(url: string): string | undefined {
  for (const prefix of CREW_CUE_LINKING_PREFIXES) {
    if (!url.startsWith(prefix)) continue;
    const rest = url.slice(prefix.length);
    const query = rest.indexOf("?");
    const raw = (query >= 0 ? rest.slice(0, query) : rest).replace(/^\/+/, "");
    return raw.length > 0 ? raw : undefined;
  }
  return undefined;
}

export function isAuthedTabDeepLinkPath(path: string): boolean {
  const root = path.split("/")[0]?.toLowerCase();
  return root !== undefined && AUTHED_TAB_ROOTS.has(root);
}
