/**
 * Deterministic PRNG.
 *
 * The whole architecture rests on client and server producing byte-identical
 * results from the same seed (docs/02-ARQUITETURA.md section 1), so the
 * simulation must never touch `Math.random`. Everything random flows through
 * this class.
 *
 * xoshiro128** with 32-bit integer state: fast, good statistical quality, and
 * exactly reproducible across JavaScript engines because it only uses `|0`,
 * `>>>` and `Math.imul`, which are all specified to the bit.
 */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number | bigint) {
    // SplitMix64-style expansion so nearby seeds produce unrelated streams.
    let x = BigInt.asUintN(64, BigInt(seed)) || 1n;
    const next = (): number => {
      x = BigInt.asUintN(64, x + 0x9e3779b97f4a7c15n);
      let z = x;
      z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
      z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
      z = z ^ (z >> 31n);
      return Number(BigInt.asUintN(32, z)) | 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Raw 32-bit unsigned value. */
  nextUint32(): number {
    const rotl = (v: number, k: number): number => ((v << k) | (v >>> (32 - k))) | 0;
    const result = Math.imul(rotl(Math.imul(this.s1, 5) | 0, 7), 9) | 0;
    const t = (this.s1 << 9) | 0;

    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);

    return result >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextUint32() / 0x100000000;
  }

  /**
   * Uniform integer in [min, max], inclusive.
   * Mirrors the engine's `uniform_random` (src/utils/tools.cpp).
   */
  uniform(min: number, max: number): number {
    const lo = Math.min(min, max) | 0;
    const hi = Math.max(min, max) | 0;
    if (lo === hi) return lo;
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /**
   * Standard normal via Box-Muller.
   *
   * Box-Muller naturally yields two values per pair of draws, but caching the
   * second one would put state outside `getState`. A session settled in one
   * call would then diverge from the same session advanced frame by frame,
   * whenever a chunk boundary landed between the two halves of a pair. The
   * discarded value costs two extra draws and buys exact resumability.
   */
  private gaussian(): number {
    let u = 0;
    let v = 0;
    // Avoid log(0).
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Bell-curved integer in [min, max], matching `normal_random` in
   * src/utils/tools.cpp:
   *
   *   normal_distribution<float>(0.5, 0.25), resampled until it lands in
   *   [0, 1], then `min + round(v * (max - min))`.
   *
   * This is what makes Tibia damage cluster around the middle of a weapon's
   * range instead of being flat, so it matters for balance.
   */
  normal(min: number, max: number): number {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    if (lo === hi) return Math.round(lo);
    let v: number;
    do {
      v = 0.5 + 0.25 * this.gaussian();
    } while (v < 0 || v > 1);
    return Math.round(lo + v * (hi - lo));
  }

  /** True with the given percentage chance (0-100). */
  chance(percent: number): boolean {
    if (percent <= 0) return false;
    if (percent >= 100) return true;
    return this.next() * 100 < percent;
  }

  /** Pick one element. Returns undefined for an empty array. */
  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(this.next() * items.length)];
  }

  /**
   * Complete internal state. Restoring it reproduces the rest of the stream
   * exactly, which is what lets a session be paused, persisted and resumed.
   */
  getState(): [number, number, number, number] {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  setState(state: readonly [number, number, number, number]): void {
    [this.s0, this.s1, this.s2, this.s3] = state;
  }
}
