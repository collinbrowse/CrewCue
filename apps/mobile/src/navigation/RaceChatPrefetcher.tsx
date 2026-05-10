import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { createApiClient, type ApiClient } from "../api/client";
import { scheduleRaceChatPrefetch } from "../features/chat/raceChatPrefetch";
import { useAuthedShell } from "../shell/AuthedShellContext";

/**
 * Warms Stream + channel key while the user is on other tabs so Chat opens on
 * cached work when possible.
 */
export function RaceChatPrefetcher(): ReactElement | null {
  const shell = useAuthedShell();
  const room = shell.room;
  const roomRef = useRef<typeof room>(room);
  roomRef.current = room;
  const authSub = shell.auth.claims?.sub;
  const accessToken = shell.auth.accessToken;
  const baseUrl = shell.baseUrl;

  const chatMembershipKey = useMemo(() => {
    const list = room?.memberships ?? [];
    return list
      .map((m) => `${m.userId}:${(m.displayName ?? "").trim()}`)
      .sort()
      .join("|");
  }, [room?.memberships]);

  const api = useMemo<ApiClient | undefined>(() => {
    if (!accessToken) return undefined;
    return createApiClient({ baseUrl, accessToken });
  }, [accessToken, baseUrl]);

  useEffect(() => {
    const r = roomRef.current;
    if (!r?.id || !authSub || !api) return;
    scheduleRaceChatPrefetch({
      room: r,
      authSub,
      api,
      memberships: r.memberships,
      chatMembershipKey
    });
  }, [room?.id, authSub, api, chatMembershipKey]);

  return null;
}
