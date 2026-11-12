/** Small, dependency-free numeric helpers for the projection backtest. Deterministic. */

/** Seeded PRNG (mulberry32) with a Box–Muller normal draw. */
export class SeededRandom {
  private state: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  gauss(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;
      return mean + sd * value;
    }
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return mean + sd * r * Math.cos(2 * Math.PI * v);
  }

  /** k distinct items, order not preserved. */
  sample<T>(items: readonly T[], k: number): T[] {
    const copy = [...items];
    for (let i = 0; i < Math.min(k, copy.length); i += 1) {
      const j = i + Math.floor(this.next() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, k);
  }
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function pvariance(values: readonly number[]): number {
  const m = mean(values);
  return mean(values.map((v) => (v - m) ** 2));
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Least-squares slope of y on x. */
export function slope(xs: readonly number[], ys: readonly number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i]! - my);
    den += (x - mx) ** 2;
  });
  return num / den;
}

/** Normal equations accumulated as A = Σ w·x·xᵀ, b = Σ w·x·y. */
export type NormalEquations = { A: number[][]; b: number[] };

export function emptyNormal(k: number): NormalEquations {
  return { A: Array.from({ length: k }, () => new Array<number>(k).fill(0)), b: new Array<number>(k).fill(0) };
}

export function accumulate(eq: NormalEquations, x: readonly number[], y: number, w = 1): void {
  for (let i = 0; i < x.length; i += 1) {
    const xi = w * x[i]!;
    eq.b[i]! += xi * y;
    const row = eq.A[i]!;
    for (let j = 0; j < x.length; j += 1) {
      row[j]! += xi * x[j]!;
    }
  }
}

export function sumNormal(parts: readonly NormalEquations[], k: number): NormalEquations {
  const out = emptyNormal(k);
  for (const part of parts) {
    for (let i = 0; i < k; i += 1) {
      out.b[i]! += part.b[i]!;
      for (let j = 0; j < k; j += 1) {
        out.A[i]![j]! += part.A[i]![j]!;
      }
    }
  }
  return out;
}

/**
 * Gauss–Jordan solve with partial pivoting. `ridge` adds ridge·A[0][0] to every diagonal but the
 * intercept's (as the reference scripts do). Returns null when singular.
 */
export function solve(eq: NormalEquations, ridge = 0): number[] | null {
  const k = eq.b.length;
  const A = eq.A.map((row) => [...row]);
  const b = [...eq.b];
  for (let i = 1; i < k; i += 1) {
    A[i]![i]! += ridge * A[0]![0]!;
  }
  for (let c = 0; c < k; c += 1) {
    let piv = c;
    for (let r = c + 1; r < k; r += 1) {
      if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) {
        piv = r;
      }
    }
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    [b[c], b[piv]] = [b[piv]!, b[c]!];
    if (Math.abs(A[c]![c]!) < 1e-12) {
      return null;
    }
    for (let r = 0; r < k; r += 1) {
      if (r !== c) {
        const f = A[r]![c]! / A[c]![c]!;
        A[r] = A[r]!.map((v, j) => v - f * A[c]![j]!);
        b[r]! -= f * b[c]!;
      }
    }
  }
  return b.map((v, i) => v / A[i]![i]!);
}

/** CRC-32 (IEEE), for a stable per-runner bucket that doesn't depend on load order. */
export function crc32(text: string): number {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
