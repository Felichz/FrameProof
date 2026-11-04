// The statistics, with no I/O: everything here takes numbers and returns numbers, so the simulations in
// test/sim run the same code the real comparisons do.
//
// A comparison's data comes in strata: one pair of adjacent blocks, one of each build, so a drift in the
// machine falls on both. A stratum is { a: number[], b: number[] }.

/** A small seeded generator: a verdict can be reproduced from its run id. */
export function rng(seed = 1) {
  let s = typeof seed === 'string' ? [...seed].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) : seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : NaN);
export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
export const median = (a) => quantile([...a].sort((x, y) => x - y), 0.5);

/** Ranks with ties sharing their middle rank, 1-based. */
export function midranks(values) {
  const order = values.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return ranks;
}

/**
 * Two-sided permutation test on ranks, shuffling only inside each stratum (van Elteren's weights). Ranks
 * rather than means, so a single 50-frame stall can't decide the result: rare episodes have their own test.
 */
export function rankTest(strata, { rounds = 4000, random = rng(1) } = {}) {
  const prepared = strata
    .filter((s) => s.a.length && s.b.length)
    .map((s) => {
      const ranks = midranks([...s.a, ...s.b]);
      return { ranks, nb: s.b.length, weight: 1 / (ranks.length + 1) };
    });
  if (!prepared.length) return 1;
  const statistic = (list) => list.reduce((t, s) => {
    let r = 0;
    for (let i = s.ranks.length - s.nb; i < s.ranks.length; i++) r += s.ranks[i];
    return t + (r - (s.nb * (s.ranks.length + 1)) / 2) * s.weight;
  }, 0);
  const observed = Math.abs(statistic(prepared));
  if (observed < 1e-12) return 1;
  let hits = 0;
  for (let r = 0; r < rounds; r++) {
    for (const s of prepared) {
      for (let i = s.ranks.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [s.ranks[i], s.ranks[j]] = [s.ranks[j], s.ranks[i]];
      }
    }
    if (Math.abs(statistic(prepared)) >= observed - 1e-12) hits++;
  }
  return (hits + 1) / (rounds + 1);
}

/** The shift from a to b: the median of every difference b - a inside a stratum. */
export function hodgesLehmann(strata) {
  const d = [];
  for (const s of strata) for (const x of s.a) for (const y of s.b) d.push(y - x);
  return d.length ? median(d) : NaN;
}

/**
 * An interval for that shift, from a bootstrap inside each stratum. Late frames are small integers, so the
 * percentile interval alone comes out too narrow on tied samples (all ones gives [0, 0], whatever n is).
 * It is widened by the resolution of the data: one count, over the square root of the repetitions, which
 * is what the simulation in test/sim needed to hold its stated coverage.
 */
export function shiftInterval(strata, { level = 0.95, rounds = 800, random = rng(2) } = {}) {
  const live = strata.filter((s) => s.a.length && s.b.length);
  if (!live.length) return [-Infinity, Infinity];
  const pick = (a) => {
    const out = new Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[Math.floor(random() * a.length)];
    return out;
  };
  // Blocks are resampled too when there are enough of them: the blocks, not the repetitions, carry the
  // drift between browsers.
  const pickStrata = () => {
    if (live.length < 4) return live;
    return Array.from(live, () => live[Math.floor(random() * live.length)]);
  };
  const shifts = new Array(rounds);
  for (let r = 0; r < rounds; r++) shifts[r] = hodgesLehmann(pickStrata().map((s) => ({ a: pick(s.a), b: pick(s.b) })));
  shifts.sort((x, y) => x - y);
  const tail = (1 - level) / 2;
  const n = Math.min(sum(live.map((s) => s.a.length)), sum(live.map((s) => s.b.length)));
  const pad = 1 / Math.sqrt(n);
  return [quantile(shifts, tail) - pad, quantile(shifts, 1 - tail) + pad];
}

const logFactorials = [0];
const logFact = (n) => {
  for (let i = logFactorials.length; i <= n; i++) logFactorials[i] = logFactorials[i - 1] + Math.log(i);
  return logFactorials[n];
};
const logChoose = (n, k) => logFact(n) - logFact(k) - logFact(n - k);

/** Fisher's exact test, two-sided, for k1 of n1 against k2 of n2. */
export function fisher(k1, n1, k2, n2) {
  const total = k1 + k2;
  const prob = (k) => Math.exp(logChoose(n1, k) + logChoose(n2, total - k) - logChoose(n1 + n2, total));
  const lo = Math.max(0, total - n2);
  const hi = Math.min(n1, total);
  const p0 = prob(k1);
  let p = 0;
  for (let k = lo; k <= hi; k++) {
    const q = prob(k);
    if (q <= p0 * (1 + 1e-9)) p += q;
  }
  return Math.min(1, p);
}

/** The binomial probability of k or fewer in n, at rate p. */
function binomialCdf(k, n, p) {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  let total = 0;
  for (let i = 0; i <= k; i++) total += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log1p(-p));
  return Math.min(1, total);
}

/** The largest rate that k of n can't rule out, one-sided (Clopper-Pearson). 0 of 30 gives about 9.5%. */
export function rateBound(k, n, level = 0.95) {
  if (!n) return 1;
  if (k >= n) return 1;
  let lo = k / n;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(k, n, mid) > 1 - level) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Holm's step-down adjustment: p-values in, adjusted p-values out, in the same order. */
export function holm(ps) {
  const order = ps.map((p, i) => [p, i]).sort((x, y) => x[0] - y[0]);
  const out = new Array(ps.length);
  let running = 0;
  order.forEach(([p, i], rank) => {
    running = Math.max(running, Math.min(1, p * (ps.length - rank)));
    out[i] = running;
  });
  return out;
}

/** A spread that a single stall can't inflate: the median absolute deviation, scaled to a normal's sd. */
export function robustSpread(a) {
  const m = median(a);
  return 1.4826 * median(a.map((x) => Math.abs(x - m)));
}

/** The sd to plan with: the robust spread, but never under what the rounding of counts leaves. */
export function planningSpread(a) {
  const sd = Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
  return Math.max(robustSpread(a), Math.min(sd, 1), 0.5);
}

/** Smallest shift n repetitions a build would see four times in five, at the 5% level (normal approximation). */
export const smallestVisible = (spread, n) => (1.96 + 0.84) * spread * Math.sqrt(2 / n);
/** Repetitions a build needs to see a shift of `effect`. */
export const repetitionsFor = (spread, effect) => Math.ceil(2 * ((1.96 + 0.84) * spread / effect) ** 2);
