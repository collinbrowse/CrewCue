/**
 * Single-flight lazy hydration: concurrent callers share one in-flight load,
 * and the hydrated flag is set only after the load callback succeeds.
 *
 * Marking hydrated before await lets a second caller skip the DB read, seed
 * empty/bootstrap state, and persist over durable runtime data.
 */
export type LazyHydrator = {
  loadIfNeeded(id: string, load: () => Promise<void>): Promise<void>;
  delete(id: string): void;
  clear(): void;
  isHydrated(id: string): boolean;
};

export function createLazyHydrator(): LazyHydrator {
  const hydrated = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();

  return {
    async loadIfNeeded(id: string, load: () => Promise<void>): Promise<void> {
      if (hydrated.has(id)) {
        return;
      }
      const existing = inFlight.get(id);
      if (existing) {
        await existing;
        return;
      }

      const promise = (async () => {
        try {
          await load();
          hydrated.add(id);
        } finally {
          inFlight.delete(id);
        }
      })();

      inFlight.set(id, promise);
      await promise;
    },

    delete(id: string): void {
      hydrated.delete(id);
      inFlight.delete(id);
    },

    clear(): void {
      hydrated.clear();
      inFlight.clear();
    },

    isHydrated(id: string): boolean {
      return hydrated.has(id);
    }
  };
}
