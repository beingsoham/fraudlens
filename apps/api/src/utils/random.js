/**
 * Deterministic pseudo-random number generation.
 *
 * The simulator and the seed script must be reproducible: the same seed has to
 * produce the same transaction stream, or a scenario cannot be re-run while
 * investigating a defect. `Math.random()` cannot be seeded, so this is a
 * small, well-known PRNG (mulberry32) with a 2^32 period — ample for
 * generating test data, and deliberately not used for anything
 * security-sensitive.
 */

export function createRng(seed = 1) {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    /** Float in [0, 1). */
    next,
    /** Integer in [min, max], inclusive. */
    int(min, max) {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    /** Float in [min, max). */
    float(min, max) {
      return next() * (max - min) + min;
    },
    /** True with probability `p`. */
    chance(p) {
      return next() < p;
    },
    /** Uniformly picks one element. */
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
    /**
     * Picks a key from `{ key: weight }` proportionally to the weights.
     * Zero and negative weights are ignored.
     */
    weighted(weights) {
      const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
      const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
      if (total <= 0) return null;
      let roll = next() * total;
      for (const [key, weight] of entries) {
        roll -= weight;
        if (roll <= 0) return key;
      }
      return entries.at(-1)[0];
    },
    /** Log-normally distributed value, for realistic payment amounts. */
    logNormal(mu, sigma) {
      // Box-Muller transform.
      const u1 = Math.max(next(), Number.EPSILON);
      const u2 = next();
      const standardNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.exp(mu + sigma * standardNormal);
    },
    /** Returns a shuffled copy of `items` (Fisher-Yates). */
    shuffle(items) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    /** Current internal state, so a run can be resumed or reported. */
    state() {
      return state;
    },
  };
}
