// The false alarm of 2026-11-04, replayed on its published shape (the raw repetitions of that day are on
// the machine that ran them, not here). A first look at scroll up at 4x read p = 0.020 and the original tool
// printed "(real)"; a repeat read p = 0.42. Here the first look's data is made to be borderline, the fresh
// data that follows is like the repeat, and the verdict must not be `worse`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, MIN_FOR_CONFIRM, measure } from '../src/core/verdict.mjs';
import { rng } from '../src/core/stats.mjs';

// The samples looked like this: mostly 0 and 1, a rare stall.
const BASE = [0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1];
// A head that reads worse on a first look by luck: a few more 1s and 2s, one stall.
const LUCKY = [1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 50, 1, 2, 1, 1];

test('the first look of the replay is borderline, as on the day', () => {
  const strata = [{ a: BASE.slice(0, 8), b: LUCKY.slice(0, 8) }, { a: BASE.slice(8), b: LUCKY.slice(8) }];
  const m = measure(strata, { random: rng(11) });
  assert.ok(m.p < 0.05, `first look p=${m.p}`);
});

test('a borderline first look that does not repeat is not called worse', async () => {
  const r = rng(7);
  const same = () => Array.from({ length: 4 }, () => (r() < 0.06 ? 30 : r() < 0.6 ? 1 : 0));
  let look = 0;
  const collect = async (ids, stage) => {
    look++;
    if (stage === 'screen' && look === 1) {
      return Object.fromEntries(ids.map((id) => [id, [
        { a: BASE.slice(0, 8), b: LUCKY.slice(0, 8), epA: BASE.slice(0, 8).map(() => false), epB: LUCKY.slice(0, 8).map((v) => v >= 8) },
        { a: BASE.slice(8), b: LUCKY.slice(8), epA: BASE.slice(8).map(() => false), epB: LUCKY.slice(8).map((v) => v >= 8) },
      ]]));
    }
    // What came after: both builds the same.
    return Object.fromEntries(ids.map((id) => [id, [0, 1].map(() => {
      const a = same();
      const b = same();
      return { a, b, epA: a.map((v) => v >= 8), epB: b.map((v) => v >= 8) };
    })]));
  };
  const v = (await decide({ cells: [{ id: 'scroll/up@4x', margin: 2 }], collect, maxLooks: 4, batchesToConfirm: (n) => Math.ceil(Math.max(n, MIN_FOR_CONFIRM) / 8) }))['scroll/up@4x'];
  assert.notEqual(v.verdict, 'worse');
  assert.match(v.reason, /did not survive the confirmation run/);
  assert.ok(v.firstRun.p < 0.05, 'the first run is kept, with its p');
});
