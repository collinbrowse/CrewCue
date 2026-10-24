/**
 * Single-flight lazy hydration: concurrent callers share one in-flight load,
 * and the hydrated flag is set only after the load callback succeeds.
 *
 * Marking hydrated before await lets a second caller skip the DB read, seed
 * empty/bootstrap state, and persist over durable runtime data.
 *
 * `delete` / `reset` bump a generation so a load already in flight cannot
 * commit what it read. `reset` also holds new loads until the durable delete
 * finishes, so they cannot hydrate the row that reset is removing.
 */
export type LazyHydrateGuard = {
  /** False once `delete`, `clear`, or `reset` has superseded this load. */
  stillCurrent(): boolean;
};

export type LazyHydrator = {
  loadIfNeeded(id: string, load: (guard: LazyHydrateGuard) => Promise<void>): Promise<void>;
  delete(id: string): void;
  /**
   * Invalidate `id`, run `clear` (delete the durable row and any cache), then
   * invalidate again. Loads that observed pre-clear state do not commit.
   */
  reset(id: string, clear: () => Promise<void>): Promise<void>;
  clear(): void;
  isHydrated(id: string): boolean;
};

type ResetGate = {
  promise: Promise<void>;
  release: () => void;
};

export function createLazyHydrator(): LazyHydrator {
  const hydrated = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();
  const generation = new Map<string, number>();
  const resetGate = new Map<string, ResetGate>();

  function generationOf(id: string): number {
    return generation.get(id) ?? 0;
  }

  function bump(id: string): void {
    generation.set(id, generationOf(id) + 1);
    hydrated.delete(id);
    inFlight.delete(id);
  }

  return {
    async loadIfNeeded(id: string, load: (guard: LazyHydrateGuard) => Promise<void>): Promise<void> {
      for (;;) {
        const gate = resetGate.get(id);
        if (gate) {
          await gate.promise;
          continue;
        }
        if (hydrated.has(id)) {
          return;
        }

        const existing = inFlight.get(id);
        if (existing) {
          const waited = generationOf(id);
          await existing;
          if (generationOf(id) === waited && hydrated.has(id)) {
            return;
          }
          continue;
        }

        const started = generationOf(id);
        const stillCurrent = () => generationOf(id) === started && !resetGate.has(id);
        let committed = false;
        // Property, not a closed-over `const`, so the in-flight body can identify itself
        // after the assignment below. The body awaits before the `finally` runs.
        const flight: { promise: Promise<void> | null } = { promise: null };
        flight.promise = (async () => {
          try {
            await load({ stillCurrent });
            if (!stillCurrent()) {
              return;
            }
            hydrated.add(id);
            committed = true;
          } finally {
            if (flight.promise && inFlight.get(id) === flight.promise) {
              inFlight.delete(id);
            }
          }
        })();

        inFlight.set(id, flight.promise);
        await flight.promise;
        if (committed && generationOf(id) === started && hydrated.has(id)) {
          return;
        }
      }
    },

    delete(id: string): void {
      bump(id);
    },

    async reset(id: string, clear: () => Promise<void>): Promise<void> {
      bump(id);
      let release: () => void = () => {};
      const gate: ResetGate = {
        promise: new Promise<void>((resolve) => {
          release = resolve;
        }),
        release: () => release()
      };
      const prior = resetGate.get(id);
      resetGate.set(id, gate);
      try {
        // `clear` must not call `loadIfNeeded` for this id: that load waits on this gate.
        if (prior) {
          await prior.promise;
        }
        await clear();
      } finally {
        bump(id);
        if (resetGate.get(id) === gate) {
          resetGate.delete(id);
        }
        gate.release();
      }
    },

    clear(): void {
      const ids = new Set<string>([...hydrated, ...inFlight.keys(), ...generation.keys(), ...resetGate.keys()]);
      const gates = [...resetGate.values()];
      resetGate.clear();
      for (const id of ids) {
        bump(id);
      }
      hydrated.clear();
      inFlight.clear();
      for (const gate of gates) {
        gate.release();
      }
    },

    isHydrated(id: string): boolean {
      return hydrated.has(id);
    }
  };
}
