/**
 * Small seeded random helpers. A fixed seed makes the fake data identical on every run,
 * so query plans and timings in docs/query-optimization.md can be reproduced.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** mulberry32: a tiny, fast PRNG. Fine for fake data, NOT for anything security-related. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Picks a value using relative weights, e.g. [['TLSv1.3', 55], ['TLSv1.2', 38]]. */
  weighted<T>(options: ReadonlyArray<readonly [T, number]>): T {
    const total = options.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [value, weight] of options) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return options[options.length - 1][0];
  }

  hex(bytes: number): string {
    return Array.from({ length: bytes }, () => this.int(0, 255).toString(16).padStart(2, '0').toUpperCase()).join('');
  }

  /** Deterministic UUID v4 shape (so re-running the seed gives the same ids). */
  uuid(): string {
    const h = this.hex(16).toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
}
