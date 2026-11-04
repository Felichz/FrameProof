// How a comparison reaches its verdict. `decide` takes a `collect` function and nothing else from the
// outside world, so test/sim drives this exact code with made-up builds.
//
// A cell is one step at one throttle. In order:
//
//   1. Screening. Repetitions grow in batches, and each look at a cell can do one of three things: it looks
//      different (a candidate), it is shown to be inside the margin (same), or it needs more data. Looking
//      after every batch would inflate a p-value, which is harmless here because a candidate proves
//      nothing: it only earns a confirmation run. `same` is the claim that can be reached by peeking, so its
//      interval spends its error across the looks: look k uses level 1 - alpha / 2^k, which sum to alpha.
//   2. Confirmation. Each candidate gets fresh repetitions, one fixed look, and only that data decides,
//      with Holm across everything being confirmed. A first run that doesn't repeat is what the false alarm
//      of 2026-11-04 looked like, and it is reported as such.
import { fisher, hodgesLehmann, holm, median, rankTest, rateBound, rng, shiftInterval, sum } from './stats.mjs';

export const ALPHA = 0.05;
/** No claim of `same` under this many repetitions a build: a run of 8 can't see a modest regression. */
export const MIN_FOR_SAME = 16;
/** A confirmation takes at least this many: at 16 a real effect of one sd slipped through 3 times in 10. */
export const MIN_FOR_CONFIRM = 24;
/** Screening starts at this many repetitions a build. */
export const MIN_FOR_SCREEN = 8;

const flat = (strata, side) => strata.flatMap((s) => s[side]);
const episodes = (strata, side) => {
  const list = strata.flatMap((s) => s[side === 'a' ? 'epA' : 'epB'] ?? []);
  return { k: list.filter(Boolean).length, n: list.length };
};

/** The numbers for one cell's data: the shift of typical frames, and the rates of rare episodes. */
export function measure(strata, { level = 1 - ALPHA, random } = {}) {
  const a = flat(strata, 'a');
  const b = flat(strata, 'b');
  const ea = episodes(strata, 'a');
  const eb = episodes(strata, 'b');
  return {
    n: { base: a.length, head: b.length },
    typical: { base: median(a), head: median(b) },
    shift: hodgesLehmann(strata),
    interval: shiftInterval(strata, { level, random }),
    level,
    p: rankTest(strata, { random }),
    episodes: { base: ea, head: eb, p: ea.n && eb.n ? fisher(ea.k, ea.n, eb.k, eb.n) : 1 },
  };
}

const direction = (m) => {
  const rate = (e) => (e.n ? e.k / e.n : 0);
  return { typical: Math.sign(m.shift), episodes: Math.sign(rate(m.episodes.head) - rate(m.episodes.base)) };
};

/** Which measure, if any, makes this look like a difference: the screening's question. */
function candidate(m, alpha = ALPHA) {
  if (m.p < alpha && direction(m).typical) return 'typical';
  if (m.episodes.p < alpha && direction(m).episodes) return 'episodes';
  return null;
}

const inside = ([lo, hi], margin) => lo >= -margin && hi <= margin;

/**
 * Runs the whole decision.
 *   cells      [{ id, margin }]
 *   collect    async (ids, stage) => ({ [id]: [strata] }) new data for those cells, or null when stopped
 *   canContinue () => bool, the time budget
 *   confirmSize (n) => how many batches a confirmation takes
 * Returns { [id]: verdict }.
 */
export async function decide({ cells, collect, canContinue = () => true, maxLooks = 6, seed = 1, batchesToConfirm }) {
  const random = rng(seed);
  const state = new Map(cells.map((c) => [c.id, { ...c, strata: [], open: true, outcome: null }]));
  let looks = 0;

  while (looks < maxLooks) {
    const open = [...state.values()].filter((c) => c.open);
    if (!open.length) break;
    if (looks > 0 && !canContinue()) break;
    const got = await collect(open.map((c) => c.id), 'screen');
    if (!got) break;
    looks++;
    for (const c of open) {
      c.strata.push(...(got[c.id] ?? []));
      const n = Math.min(flat(c.strata, 'a').length, flat(c.strata, 'b').length);
      if (n < MIN_FOR_SCREEN) continue;
      const spent = 1 - ALPHA / 2 ** looks;
      const m = measure(c.strata, { level: spent, random });
      c.last = m;
      const kind = candidate(m);
      if (kind) {
        c.open = false;
        c.outcome = { stage: 'candidate', kind, first: m };
      } else if (n >= MIN_FOR_SAME && inside(m.interval, c.margin)) {
        c.open = false;
        c.outcome = { stage: 'same', first: m };
      }
    }
  }

  // Confirmation: fresh data, one look.
  const candidates = [...state.values()].filter((c) => c.outcome?.stage === 'candidate');
  const fresh = new Map(candidates.map((c) => [c.id, []]));
  const wanted = candidates.length ? batchesToConfirm?.(Math.max(...candidates.map((c) => c.outcome.first.n.base))) ?? 2 : 0;
  for (let i = 0; i < wanted; i++) {
    const got = await collect(candidates.map((c) => c.id), 'confirm');
    if (!got) break;
    for (const c of candidates) fresh.get(c.id).push(...(got[c.id] ?? []));
  }
  const confirmed = candidates.map((c) => ({ c, m: fresh.get(c.id).length ? measure(fresh.get(c.id), { random }) : null }));
  const tested = confirmed.filter((x) => x.m);
  const adjusted = holm(tested.map(({ c, m }) => (c.outcome.kind === 'typical' ? m.p : m.episodes.p)));
  tested.forEach((x, i) => (x.adjusted = adjusted[i]));

  const out = {};
  for (const c of state.values()) {
    if (c.outcome?.stage === 'same') out[c.id] = report(c, 'same', c.outcome.first, `the interval sits inside the margin of ±${c.margin}`);
    else if (c.outcome?.stage === 'candidate') {
      const x = confirmed.find((y) => y.c === c);
      out[c.id] = judgeConfirmation(c, x);
    } else if (c.last) out[c.id] = report(c, 'inconclusive', c.last, stoppedWhy(c));
    else out[c.id] = { id: c.id, verdict: 'inconclusive', reason: 'too few repetitions to look at', margin: c.margin };
  }
  return out;
}

function stoppedWhy(c) {
  const m = c.last;
  const [lo, hi] = m.interval;
  if (m.n.base < MIN_FOR_SAME) return `only ${m.n.base} repetitions a build, under the ${MIN_FOR_SAME} a claim of same needs`;
  return `the interval [${round(lo)}, ${round(hi)}] is wider than the margin of ±${c.margin}`;
}

function judgeConfirmation(c, x) {
  const { kind, first } = c.outcome;
  const firstP = kind === 'typical' ? first.p : first.episodes.p;
  if (!x?.m) return report(c, 'inconclusive', first, `first run p=${round(firstP, 3)}, and the time ran out before a confirmation`);
  const m = x.m;
  const before = direction(first)[kind];
  const after = direction(m)[kind];
  if (x.adjusted < ALPHA && after === before) return report(c, after > 0 ? 'worse' : 'better', m, `confirmed on fresh repetitions (${kind === 'typical' ? 'typical frames' : 'rare episodes'}, p=${round(x.adjusted, 3)} after Holm)`, first);
  if (inside(m.interval, c.margin) && m.n.base >= MIN_FOR_SAME && kind === 'typical') return report(c, 'same', m, `first run p=${round(firstP, 3)} did not survive the confirmation run, and the fresh interval sits inside the margin`, first);
  return report(c, 'inconclusive', m, `first run p=${round(firstP, 3)} did not survive the confirmation run`, first);
}

function report(c, verdict, m, reason, first) {
  const fmt = (e) => `${e.k}/${e.n}`;
  const bound = (e) => (e.k === 0 && e.n ? `under ${Math.round(rateBound(0, e.n) * 100)}% at 95%` : undefined);
  return {
    id: c.id,
    verdict,
    reason,
    effect: { lateFrames: round(m.shift), interval: m.interval.map((v) => round(v)), level: round(m.level, 3) },
    typical: m.typical,
    episodes: { base: fmt(m.episodes.base), head: fmt(m.episodes.head), p: round(m.episodes.p, 3), baseBound: bound(m.episodes.base), headBound: bound(m.episodes.head) },
    n: m.n,
    margin: c.margin,
    p: round(m.p, 4),
    firstRun: first ? { p: round(first.p, 4), n: first.n, shift: round(first.shift) } : undefined,
  };
}

export const round = (v, digits = 2) => (Number.isFinite(v) ? +v.toFixed(digits) : v);

/** The status of a whole comparison, from its cells. A mixed result answers with the bad news. */
export function overall(verdicts) {
  const list = verdicts.map((v) => v.verdict);
  if (list.includes('invalid')) return 'invalid';
  if (list.includes('worse')) return 'worse';
  if (list.includes('inconclusive')) return list.includes('better') ? 'better' : 'inconclusive';
  if (list.includes('better')) return 'better';
  return list.length ? 'same' : 'inconclusive';
}

/** Accumulates episode counts over earlier runs of the same pair: the sum done by hand on 2026-11-04. */
export function accumulateEpisodes(list) {
  const total = (side) => ({ k: sum(list.map((e) => e[side].k)), n: sum(list.map((e) => e[side].n)) });
  const base = total('base');
  const head = total('head');
  return { base, head, runs: list.length, p: base.n && head.n ? fisher(base.k, base.n, head.k, head.n) : 1 };
}
