// Golden traces: real Chrome traces of the sample app, trimmed (test/fixtures/make.mjs), with known causes.
// They pin the trace reader to the Chrome version in each file's name, with no browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { findFreezes, groupFreezes } from '../src/core/freezes.mjs';
import { reduceWork } from '../src/core/ledger.mjs';
import { countFrames, readFrames, readTrace } from '../src/core/trace.mjs';

const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const load = (name) => JSON.parse(gunzipSync(readFileSync(`${dir}${name}`)));
const placeTrace = (s) => {
  const file = (s.url ?? '').replace(/^https?:\/\/[^/]+/, '') || '(native)';
  return { file, where: `${file}:${s.lineNumber ?? '?'}${s.functionName ? ' ' + s.functionName : ''}`, mapped: false, tool: (s.url ?? '').startsWith('pptr:') };
};
const read = (name) => {
  const f = load(name);
  const t = readTrace(f.events, f.mainFrame);
  const frames = readFrames(t);
  return { f, t, frames, counts: countFrames(frames, f.vsyncMs) };
};
const fixtures = readdirSync(dir).filter((x) => x.endsWith('.json.gz'));

test('there are golden traces', () => {
  assert.ok(fixtures.length >= 2, fixtures.join(', '));
});

for (const name of fixtures.filter((x) => x.startsWith('scroll-forced-layout'))) {
  test(`${name}: the scroll handler's forced layout is named, with its line`, () => {
    const { t, frames, counts, f } = read(name);
    assert.ok(counts.frames > 30, `frames ${counts.frames}`);
    assert.ok(counts.late >= 2, `late ${counts.late}`);
    const freezes = findFreezes(t, frames, { vsyncMs: f.vsyncMs, minMs: 30, placeTrace });
    assert.ok(freezes.length >= 1);
    assert.match(freezes[0].verdict, /layout forced .* at \/src\/sticky-header\.js:6/);
    const work = reduceWork(t, placeTrace);
    assert.ok(work.totals.forced > 0);
    assert.ok(Object.keys(work.forced).some((k) => /^layout \/src\/sticky-header\.js:6/.test(k)), Object.keys(work.forced).join('; '));
    const groups = groupFreezes([{ scenario: 'scroll', step: 'down', rep: 0, freezes }]);
    assert.equal(groups[0].in, 1);
  });
}

for (const name of fixtures.filter((x) => x.startsWith('cart-restyle'))) {
  test(`${name}: opening the cart restyles most of the page, forced from cart.js`, () => {
    const { t, frames, f } = read(name);
    const freezes = findFreezes(t, frames, { vsyncMs: f.vsyncMs, minMs: 30, placeTrace });
    assert.ok(freezes.length >= 1);
    assert.match(freezes[0].verdict, /style forced \d{4} elements .* at \/src\/cart\.js/);
  });
}

for (const name of fixtures.filter((x) => x.startsWith('idle-raf'))) {
  test(`${name}: at rest, the ticker asks for frames every frame`, () => {
    const { t } = read(name);
    const work = reduceWork(t, placeTrace);
    const ticker = Object.entries(work.askers).filter(([k]) => /^rAF \/src\/ticker\.js/.test(k)).reduce((s, [, n]) => s + n, 0);
    assert.ok(ticker > 60, `ticker asked ${ticker}`);
    assert.equal(work.totals.layouts, 0);
  });
}
