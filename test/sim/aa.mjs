// Does a verdict mean what it says? This drives the real decision code (src/core/verdict.mjs) with made-up
// builds whose truth is known:
//
//   A/A          the builds are the same: `better` or `worse` must stay at or under the stated rate, in any
//                comparison, however many cells it has.
//   shifted      head really is worse: how often it says so, and it must never say `better`.
//   beyond       head is worse by more than the margin: `same` must stay at or under the stated rate.
//
// The samples imitate the real ones of 2026-11-04: mostly 0s and 1s, with a rare stall (`[0 1 1 1 1 1 50 0]`),
// and a block effect, since each block is a browser of its own.
//
//   npm run sim [-- --trials 400]
import { decide, MIN_FOR_CONFIRM } from '../../src/core/verdict.mjs';
import { rng } from '../../src/core/stats.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const TRIALS = arg('trials', 300);

const SHAPES = {
  // Mostly 0 and 1 with rare stalls: the scroll of 2026-11-04.
  sparse: (r) => (r() < 0.06 ? 8 + Math.floor(r() * 45) : r() < 0.55 ? 1 : r() < 0.8 ? 0 : 2),
  // A busier step, as opening a window at 4x.
  busy: (r) => Math.max(0, Math.round(14 + 4 * gauss(r))),
  // Every repetition the same: the worst case for a bootstrap.
  flat: () => 1,
};
function gauss(r) {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

/** A comparison of `cells` cells, each batch two strata of 4 repetitions a build. */
async function trial({ shape, shift = 0, cells = 6, margin = 2, seed }) {
  const r = rng(seed);
  const draw = SHAPES[shape];
  const block = (extra, drift) => Array.from({ length: 4 }, () => Math.max(0, draw(r) + extra + drift));
  const stall = (list) => list.map((v) => v >= 8 && shape === 'sparse');
  const stratum = () => {
    const drift = shape === 'busy' ? Math.round(gauss(r) * 1.5) : 0;
    const a = block(0, drift);
    const b = block(shift, drift);
    return { a, b, epA: stall(a), epB: stall(b) };
  };
  const list = Array.from({ length: cells }, (_, i) => ({ id: `c${i}`, margin }));
  const verdicts = await decide({
    cells: list,
    seed,
    collect: async (ids) => Object.fromEntries(ids.map((id) => [id, [stratum(), stratum()]])),
    maxLooks: 5,
    batchesToConfirm: (n) => Math.ceil(Math.max(n, MIN_FOR_CONFIRM) / 8),
  });
  return Object.values(verdicts).map((v) => v.verdict);
}

async function run(name, opts, read) {
  const counts = { better: 0, worse: 0, same: 0, inconclusive: 0 };
  let anyClaim = 0;
  let cells = 0;
  for (let t = 0; t < TRIALS; t++) {
    const verdicts = await trial({ ...opts, seed: t * 7919 + 13 });
    verdicts.forEach((v) => counts[v]++);
    cells += verdicts.length;
    if (verdicts.some((v) => v === 'better' || v === 'worse')) anyClaim++;
  }
  const pct = (n, of) => `${((100 * n) / of).toFixed(1)}%`;
  const line = { name, comparisons: TRIALS, cells, better: pct(counts.better, cells), worse: pct(counts.worse, cells), same: pct(counts.same, cells), inconclusive: pct(counts.inconclusive, cells), anyClaimPerComparison: pct(anyClaim, TRIALS) };
  console.log(JSON.stringify(line));
  return read({ counts, cells, anyClaim });
}

const checks = [];
const expect = (what, ok, got) => {
  checks.push({ what, ok, got });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}: ${got}`);
};

for (const shape of ['sparse', 'busy', 'flat']) {
  await run(`A/A ${shape}, 6 cells`, { shape }, ({ anyClaim, counts, cells }) => {
    if (shape !== 'busy') expect(`A/A ${shape}: same is reachable, in at least 80% of cells`, counts.same / cells >= 0.8, `${((100 * counts.same) / cells).toFixed(1)}%`);
    const rate = anyClaim / TRIALS;
    expect(`A/A ${shape}: a false claim in at most 5% of whole comparisons`, rate <= 0.05, `${(rate * 100).toFixed(1)}%`);
  });
}
await run('shifted busy +4', { shape: 'busy', shift: 4, cells: 2 }, ({ counts, cells }) => {
  expect('a real +4 on a busy step: found in at least 80% of cells', counts.worse / cells >= 0.8, `${((100 * counts.worse) / cells).toFixed(1)}%`);
  expect('a real +4: never called better', counts.better === 0, String(counts.better));
});
await run('beyond the margin, busy +3 with margin 2', { shape: 'busy', shift: 3, cells: 2 }, ({ counts, cells }) => {
  expect('beyond the margin: `same` in at most 5% of cells', counts.same / cells <= 0.05, `${((100 * counts.same) / cells).toFixed(1)}%`);
});
await run('beyond the margin, sparse +3 with margin 2', { shape: 'sparse', shift: 3, cells: 2 }, ({ counts, cells }) => {
  expect('beyond the margin on sparse data: `same` in at most 5% of cells', counts.same / cells <= 0.05, `${((100 * counts.same) / cells).toFixed(1)}%`);
});
process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
