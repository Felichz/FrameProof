// The alternated A/B that compare, price and calibrate share. Each look runs two strata per throttle, in
// ABBA order, each stratum a block of each build in its own browser; the decision code in core/verdict.mjs
// takes it from there. A cell is one step at one throttle.
import { decide, MIN_FOR_CONFIRM, overall } from '../core/verdict.mjs';
import { blocks, Clock, progress } from '../session.mjs';
import { cellId, marginFor } from './_shared.mjs';

/** How much of a cell's repetitions may fail before its verdict is `invalid`. */
const FAIL_SHARE = 0.25;

export async function abSession(ctx, { run, base, head, scenarios, throttles, reps = 4, minutes = 20, looks = 6, injectA = null, injectB = null, plan: planOverride, decideOpts = {} }) {
  const clock = new Clock(minutes);
  const list = scenarios.filter((s) => !s.journey);
  const cells = [];
  const meta = new Map();
  for (const s of list)
    for (const st of s.steps)
      for (const th of throttles) {
        const id = cellId(s.name, st.name, th);
        const m = marginFor(ctx, s, st.name, th);
        cells.push({ id, margin: m.margin });
        meta.set(id, { scenario: s.name, step: st.name, throttle: th, marginFrom: m.from, fails: { a: [], b: [] }, ran: { a: 0, b: 0 }, values: { a: [], b: [] } });
      }
  let strata = 0;
  let blockNo = 0;
  const placements = new Set();

  async function collect(ids, stage) {
    if (stage === 'screen' && strata > 0 && !clock.ok()) return null;
    const out = Object.fromEntries(ids.map((id) => [id, []]));
    for (const th of throttles) {
      const want = new Set(ids.filter((id) => meta.get(id).throttle === th).map((id) => meta.get(id).scenario));
      if (!want.size) continue;
      const plan = planOverride ?? list.filter((s) => want.has(s.name));
      for (let k = 0; k < 2; k++) {
        const order = strata % 2 === 0 ? ['a', 'b'] : ['b', 'a'];
        const got = {};
        for (const side of order) {
          const build = side === 'a' ? base : head;
          const r = await blocks({ config: ctx.config, build, plan, reps, throttle: th, depth: 'light', inject: side === 'a' ? injectA : injectB, run, tag: side, block: blockNo++, flags: ctx.flags, keep: 'none' });
          placements.add(r.placement);
          got[side] = r.records;
        }
        strata++;
        for (const id of ids) {
          const m = meta.get(id);
          if (m.throttle !== th) continue;
          const pickSide = (side) => got[side].filter((r) => r.scenario === m.scenario && r.step === m.step);
          const stratum = { a: [], b: [], epA: [], epB: [] };
          for (const side of ['a', 'b']) {
            for (const r of pickSide(side)) {
              m.ran[side]++;
              if (!r.ok) {
                m.fails[side].push(r.failure);
                continue;
              }
              stratum[side].push(r.counts.late);
              m.values[side].push(r.counts.late);
              stratum[side === 'a' ? 'epA' : 'epB'].push(!!r.episode);
            }
          }
          out[id].push(stratum);
        }
      }
      progress(`${stage}: ${strata} strata so far, ${Math.max(0, Math.round(clock.left() / 60000))} min left of the budget`);
    }
    return out;
  }

  const verdicts = await decide({
    cells,
    collect,
    canContinue: () => clock.ok(),
    maxLooks: looks,
    seed: run.id,
    batchesToConfirm: (n) => Math.ceil(Math.max(n, MIN_FOR_CONFIRM) / (2 * reps)),
    ...decideOpts,
  });

  // A cell whose steps failed too often is judged on what didn't fail: it's invalid, and says why.
  const results = cells.map(({ id }) => {
    const v = { ...verdicts[id], id };
    const m = meta.get(id);
    v.throttle = m.throttle;
    v.marginFrom = m.marginFrom;
    const share = (side) => (m.ran[side] ? m.fails[side].length / m.ran[side] : 0);
    if (share('a') > FAIL_SHARE || share('b') > FAIL_SHARE) {
      const which = share('b') > FAIL_SHARE && share('a') <= FAIL_SHARE ? 'head only' : share('a') > FAIL_SHARE && share('b') <= FAIL_SHARE ? 'base only' : 'both builds';
      const first = (m.fails.b[0] ?? m.fails.a[0]) || {};
      v.verdict = 'invalid';
      v.reason = `the step failed in ${m.fails.a.length}/${m.ran.a} base and ${m.fails.b.length}/${m.ran.b} head repetitions (${which}): ${first.kind}, ${first.reason}${which === 'head only' ? '. The change may have broken this step: that is a finding, not noise' : ''}`;
    } else if (m.fails.a.length + m.fails.b.length) v.failures = { base: m.fails.a.length, head: m.fails.b.length, kinds: [...new Set([...m.fails.a, ...m.fails.b].map((f) => f.kind))] };
    return v;
  });
  return { results, status: overall(results), placements: [...placements], strata, raw: Object.fromEntries([...meta].map(([id, m]) => [id, m.values])), elapsedMin: +((minutes * 60000 - clock.left()) / 60000).toFixed(1) };
}

/** A cell, as few tokens as it can be and still be read right. */
export function compact(v) {
  return {
    cell: v.id,
    verdict: v.verdict,
    effect: v.effect ? { lateFrames: v.effect.lateFrames, interval: v.effect.interval } : undefined,
    typical: v.typical,
    episodes: v.episodes ? `${v.episodes.base} vs ${v.episodes.head}, p=${v.episodes.p}` : undefined,
    n: v.n ? `${v.n.base}+${v.n.head}` : undefined,
    margin: v.margin,
    reason: v.reason,
  };
}
