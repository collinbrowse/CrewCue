export type ActionPolicy = "ignoreIfBusy" | "lock" | "replace";

export type ActionRunStatus = "started" | "skipped" | "replaced";

export type ActionRunResult<T> = {
  status: ActionRunStatus;
  value?: T;
};

type InFlightEntry = {
  policy: ActionPolicy;
  controller: AbortController;
  promise: Promise<unknown>;
};

export class ActionRegistry {
  private readonly inFlight = new Map<string, InFlightEntry>();

  async run<T>(
    key: string,
    policy: ActionPolicy,
    fn: (signal: AbortSignal) => Promise<T>
  ): Promise<ActionRunResult<T>> {
    const existing = this.inFlight.get(key);

    if (existing) {
      if (policy === "ignoreIfBusy" || policy === "lock") {
        return { status: "skipped" };
      }
      existing.controller.abort();
      this.inFlight.delete(key);
    }

    const controller = new AbortController();
    const promise = (async () => {
      try {
        return await fn(controller.signal);
      } finally {
        const current = this.inFlight.get(key);
        if (current?.controller === controller) {
          this.inFlight.delete(key);
        }
      }
    })();

    this.inFlight.set(key, { policy, controller, promise });

    const value = (await promise) as T;
    const status: ActionRunStatus = existing && policy === "replace" ? "replaced" : "started";
    return { status, value };
  }

  isBusy(key: string): boolean {
    return this.inFlight.has(key);
  }

  abort(key: string): void {
    const entry = this.inFlight.get(key);
    if (entry) {
      entry.controller.abort();
      this.inFlight.delete(key);
    }
  }
}

export function createActionRegistry(): ActionRegistry {
  return new ActionRegistry();
}
