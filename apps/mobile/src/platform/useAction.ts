import { useCallback, useState } from "react";
import type { ActionPolicy, ActionRunResult } from "@crewcue/platform-client";
import { appActionRegistry } from "./runtime";

export function useAction<T>(key: string, policy: ActionPolicy): {
  execute: (fn: (signal: AbortSignal) => Promise<T>) => Promise<ActionRunResult<T>>;
  isPending: boolean;
} {
  const [isPending, setIsPending] = useState(false);

  const execute = useCallback(
    async (fn: (signal: AbortSignal) => Promise<T>): Promise<ActionRunResult<T>> => {
      if (policy === "lock" && appActionRegistry.isBusy(key)) {
        return { status: "skipped" };
      }
      setIsPending(true);
      try {
        return await appActionRegistry.run(key, policy, fn);
      } finally {
        setIsPending(appActionRegistry.isBusy(key));
      }
    },
    [key, policy]
  );

  return { execute, isPending };
}
