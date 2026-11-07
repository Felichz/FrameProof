// ADR 0002: the search, on a judge that knows the answer; candidates and their shorthands; commits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bisect, bisectCommits, combine, expand } from '../src/core/bisect.mjs';

const cands = (...names) => names.map((n) => expand(`hide:.${n}`));
/** A judge whose page gets better when any of `causes` is away (or, with `all`, only when all are). */
const judge = (causes, { all = false } = {}) => {
  const calls = [];
  const fn = async (set) => {
    calls.push(set.map((c) => c.label));
    const away = new Set(set.map((c) => c.label));
    const hits = causes.filter((c) => away.has(`hide:.${c}`)).length;
    return { better: all ? hits === causes.length : hits > 0 };
  };
  fn.calls = calls;
  return fn;
};

test('one cause among eight is found in a few splits', async () => {
  const j = judge(['f']);
  const r = await bisect(cands('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'), j);
  assert.deepEqual(r.culprits.map((c) => c.label), ['hide:.f']);
  assert.ok(j.calls.length <= 7, `${j.calls.length} splits`);
});

test('two causes are both found', async () => {
  const r = await bisect(cands('a', 'b', 'c', 'd'), judge(['a', 'd']));
  assert.deepEqual(r.culprits.map((c) => c.label).sort(), ['hide:.a', 'hide:.d']);
});

test('a cost that shows only together is said, not guessed', async () => {
  const r = await bisect(cands('a', 'b'), judge(['a', 'b'], { all: true }));
  assert.deepEqual(r.culprits, []);
  assert.deepEqual(r.together, ['hide:.a + hide:.b']);
});

test('a group that does not explain it stops at once', async () => {
  const j = judge([]);
  const r = await bisect(cands('a', 'b', 'c'), j);
  assert.equal(r.explained, false);
  assert.equal(j.calls.length, 1);
});

test('a resumed search reuses what it measured', async () => {
  const first = await bisect(cands('a', 'b', 'c', 'd'), judge(['c']), { maxSteps: 2 });
  const j = judge(['c']);
  const again = await bisect(cands('a', 'b', 'c', 'd'), j, { known: first.cache });
  assert.deepEqual(again.culprits.map((c) => c.label), ['hide:.c']);
  assert.ok(j.calls.length < first.steps.length + 4);
  for (const set of j.calls) assert.ok(!Object.keys(first.cache).includes(set.sort().join(' + ')), `measured again: ${set}`);
});

test('shorthands take away what they say, and combine into one script', () => {
  assert.match(expand('invisible:.x').css, /\.x\{visibility:hidden!important\}/);
  assert.match(expand('still:.x').css, /animation:none!important/);
  assert.match(expand('flat:.x').css, /box-shadow:none!important/);
  assert.match(expand('pause:video').js, /v\.pause\(\)/);
  assert.match(expand('off:warm').js, /__frameproof\.off.*"warm"/);
  assert.throws(() => expand('nope:.x'), /no candidate kind "nope"/);
  const dir = mkdtempSync(join(tmpdir(), 'fp-bisect-'));
  const inject = combine([expand('hide:.a,.b'), expand('off:warm')], dir, 'step-1');
  const js = readFileSync(inject.slice(3), 'utf8');
  assert.match(js, /\.a,\.b\{display:none!important\}/);
  assert.match(js, /"warm"/);
});

test('the first bad commit is found by halving', async () => {
  const commits = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
  const seen = [];
  const r = await bisectCommits(commits, async (c) => (seen.push(c), { bad: commits.indexOf(c) >= 5 }));
  assert.equal(r.first, 'c6');
  assert.ok(seen.length <= 3, seen.join(','));
});
