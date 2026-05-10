import type { RaceChatBootstrapResult, RaceChatPrefetchInput, RaceChatSessionInput } from "./raceChatBootstrap";
import { bootstrapRaceChatSession } from "./raceChatBootstrap";

/** Do not reuse a prefetch result after this age — channel state may be stale. */
const PREFETCH_MAX_AGE_MS = 90_000;

type PrefetchSlot = {
  key: string;
  startedAtMs: number;
  promise: Promise<RaceChatBootstrapResult>;
};

let slot: PrefetchSlot | undefined;

function stripPrefetchKey(args: RaceChatPrefetchInput): RaceChatSessionInput {
  const { room, authSub, api, memberships } = args;
  return { room, authSub, api, memberships };
}

export function raceChatPrefetchKey(roomId: string, authSub: string, chatMembershipKey: string): string {
  return `${roomId}\u0000${authSub}\u0000${chatMembershipKey}`;
}

/** Fire-and-forget warm path while the user is elsewhere in the app. */
export function scheduleRaceChatPrefetch(args: RaceChatPrefetchInput): void {
  const key = raceChatPrefetchKey(args.room.id, args.authSub, args.chatMembershipKey);
  if (slot?.key === key) return;
  slot = { key, startedAtMs: Date.now(), promise: bootstrapRaceChatSession(stripPrefetchKey(args)) };
  void slot.promise.catch(() => {
    if (slot?.key === key) slot = undefined;
  });
}

/**
 * Awaits in-flight prefetch for the same room/roster key, otherwise runs
 * bootstrap. Clears a successfully matching prefetch slot so it is not reused
 * after navigation.
 */
export async function consumeOrBootstrapRaceChat(args: RaceChatPrefetchInput): Promise<RaceChatBootstrapResult> {
  const key = raceChatPrefetchKey(args.room.id, args.authSub, args.chatMembershipKey);
  const cur = slot;
  if (cur?.key === key) {
    try {
      const result = await cur.promise;
      if (slot !== cur || cur.key !== key) {
        return bootstrapRaceChatSession(stripPrefetchKey(args));
      }
      const age = Date.now() - cur.startedAtMs;
      slot = undefined;
      if (age > PREFETCH_MAX_AGE_MS) {
        return bootstrapRaceChatSession(stripPrefetchKey(args));
      }
      return result;
    } catch {
      if (slot === cur) slot = undefined;
      // fall through to fresh bootstrap
    }
  }
  return bootstrapRaceChatSession(stripPrefetchKey(args));
}
