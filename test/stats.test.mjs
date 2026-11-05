import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fisher, hodgesLehmann, holm, median, midranks, rankTest, rateBound, repetitionsFor, rng, shiftInterval, smallestVisible } from '../src/core/stats.mjs';

test('Fisher on the stalls of 2026-11-04: 6 of 40 against 3 of 40 is far from significant', () => {
  const p = fisher(6, 40, 3, 40);
  assert.ok(p > 0.4 && p < 0.55, `p=${p}`);
});

test('Fisher on a clear difference', () => {
  assert.ok(fisher(0, 30, 12, 30) < 0.001);
  assert.ok(Math.abs(fisher(5, 20, 5, 20) - 1) < 1e-9);
});

test('nothing seen in 30 repetitions still allows a rate up to about 9.5%', () => {
  const b = rateBound(0, 30);
  assert.ok(b > 0.09 && b < 0.1, `bound=${b}`);
  assert.equal(rateBound(5, 5), 1);
});

test('Holm keeps order and never lowers a p-value', () => {
  const adj = holm([0.01, 0.04, 0.03]);
  assert.deepEqual(adj.map((x) => +x.toFixed(3)), [0.03, 0.06, 0.06]);
  for (const [i, p] of [0.01, 0.04, 0.03].entries()) assert.ok(adj[i] >= p);
});

test('midranks share ties', () => {
  assert.deepEqual(midranks([5, 1, 5, 3]), [3.5, 1, 3.5, 2]);
});

test('Hodges-Lehmann reads the shift, and one huge stall does not move it', () => {
  const strata = [{ a: [1, 1, 1, 0, 1, 1, 50, 0], b: [3, 3, 2, 3, 3, 3, 2, 3] }];
  assert.equal(hodgesLehmann(strata), 2);
  assert.equal(median([1, 3, 2]), 2);
});

test('the rank test does not let a single 50-frame stall decide', () => {
  const p = rankTest([{ a: [0, 1, 1, 1, 1, 1, 50, 0], b: [1, 0, 1, 1, 1, 0, 1, 1] }], { random: rng(3) });
  assert.ok(p > 0.3, `p=${p}`);
});

test('the shift interval on identical samples is not collapsed to zero width', () => {
  const [lo, hi] = shiftInterval([{ a: Array(16).fill(1), b: Array(16).fill(1) }], { random: rng(4) });
  assert.ok(lo < 0 && hi > 0);
});

test('planning: more repetitions see smaller effects', () => {
  assert.ok(smallestVisible(1, 48) < smallestVisible(1, 16));
  assert.equal(repetitionsFor(1, 1), 16);
});
