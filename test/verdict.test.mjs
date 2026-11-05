import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accumulateEpisodes, decide, MIN_FOR_CONFIRM, overall } from '../src/core/verdict.mjs';
import { rng } from '../src/core/stats.mjs';

/** A collector of made-up builds: base around 1 late frame, head shifted by `shift`. */
function builds(shift, seed = 1) {
  const r = rng(seed);
  const draw = () => (r() < 0.5 ? 1 : r() < 0.7 ? 0 : 2);
  const stratum = () => {
    const a = Array.from({ length: 4 }, draw);
    const b = Array.from({ length: 4 }, () => draw() + shift);
    return { a, b, epA: a.map(() => false), epB: b.map(() => false) };
  };
  return async (ids) => Object.fromEntries(ids.map((id) => [id, [stratum(), stratum()]]));
}

const cells = [{ id: 'scroll/down@4x', margin: 2 }];
const opts = { maxLooks: 5, batchesToConfirm: (n) => Math.ceil(Math.max(n, MIN_FOR_CONFIRM) / 8) };

test('a real regression of 5 frames is called worse, after a confirmation run', async () => {
  const v = (await decide({ cells, collect: builds(5), ...opts }))['scroll/down@4x'];
  assert.equal(v.verdict, 'worse');
  assert.match(v.reason, /confirmed on fresh repetitions/);
  assert.ok(v.firstRun, 'keeps the screening run');
});

test('a real improvement is called better', async () => {
  const collect = async (ids) => {
    const got = await builds(0, 9)(ids);
    for (const id of ids) for (const s of got[id]) [s.a, s.b] = [s.a.map((x) => x + 5), s.b];
    return got;
  };
  assert.equal((await decide({ cells, collect, ...opts }))['scroll/down@4x'].verdict, 'better');
});

test('the same build against itself ends in same once the interval fits the margin', async () => {
  const v = (await decide({ cells, collect: builds(0, 2), ...opts }))['scroll/down@4x'];
  assert.equal(v.verdict, 'same');
  assert.ok(v.n.base >= 16);
});

test('stopped early, a comparison is inconclusive, never same', async () => {
  let calls = 0;
  const v = (await decide({ cells, collect: async (ids) => (calls++ < 1 ? builds(0, 5)(ids) : null), ...opts }))['scroll/down@4x'];
  assert.equal(v.verdict, 'inconclusive');
  assert.match(v.reason, /under the 16/);
});

test('the status of a comparison answers with the bad news', () => {
  assert.equal(overall([{ verdict: 'better' }, { verdict: 'worse' }]), 'worse');
  assert.equal(overall([{ verdict: 'same' }, { verdict: 'invalid' }]), 'invalid');
  assert.equal(overall([{ verdict: 'same' }, { verdict: 'inconclusive' }]), 'inconclusive');
  assert.equal(overall([{ verdict: 'same' }, { verdict: 'same' }]), 'same');
});

test('episodes accumulate over runs, with their test', () => {
  const e = accumulateEpisodes([
    { base: { k: 3, n: 20 }, head: { k: 1, n: 20 } },
    { base: { k: 3, n: 20 }, head: { k: 2, n: 20 } },
  ]);
  assert.deepEqual([e.base.k, e.base.n, e.head.k, e.runs], [6, 40, 3, 2]);
  assert.ok(e.p > 0.4);
});
