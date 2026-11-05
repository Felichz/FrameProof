// ADR 0001's pieces that need no browser: the serving mode, the late-frame timeline, verdicts that name a
// frame that just started, the mode note, and a base that reads unlike the last run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lateTimeline, modeOf } from '../src/core/trace.mjs';
import { verdict } from '../src/core/freezes.mjs';
import { baseDrift, modeKey, modeNote } from '../src/commands/_shared.mjs';

const trace = (docs, pagePid = 10) => ({ docs: new Map(Object.entries(docs)), mainFrame: 'main', pagePid, ours: new Set([pagePid]), events: [], actTs: 1_000_000 });

test('a local subframe in another process is apart; one in the page\'s process is together', () => {
  const t = trace({
    main: { url: 'http://127.0.0.1:5000/', pid: 10 },
    a: { url: 'http://localhost:5000/stage/', pid: 22, parent: 'main' },
    b: { url: 'http://127.0.0.1:5000/stage/', pid: 10, parent: 'main' },
    c: { url: 'https://example.com/ad', pid: 30, parent: 'main' },
  });
  assert.deepEqual(modeOf(t), { page: '127.0.0.1:5000', apart: ['localhost:5000'], together: ['127.0.0.1:5000'] });
});

test('the mode note says it, and two modes are two keys', () => {
  const apart = [{ mode: { page: '127.0.0.1:5000', apart: ['localhost:5000'], together: [] } }];
  const together = [{ mode: { page: '[::1]:5000', apart: [], together: ['[::1]:5000'] } }];
  assert.match(modeNote(apart), /frames from localhost ran in their own process/);
  assert.match(modeNote(together), /shared the page's process/);
  assert.equal(modeNote([{ mode: { page: 'x', apart: [], together: [] } }]), '');
  assert.notEqual(modeKey(apart), modeKey(together));
  // A new port each block is still one mode.
  const ports = [5000, 5001, 5002].map((p) => ({ mode: { page: `[::1]:${p}`, apart: [], together: [`[::1]:${p}`] } }));
  assert.equal(modeNote(ports), "mode: page on [::1]; frames from [::1] shared the page's process");
});

test('the timeline keeps late frames from the act, and the page\'s marks', () => {
  const t = trace({ main: { url: 'http://x/', pid: 10 } });
  t.events = [
    { cat: 'blink.user_timing', pid: 10, ts: 1_200_000, name: 'live:mount:app' },
    { cat: 'blink.user_timing', pid: 10, ts: 1_000_000, name: 'perf:act' },
  ];
  const frames = [{ ts: 1_016_000, bad: false }, { ts: 1_250_000, bad: true, stage: 'main' }, { ts: 1_266_000, bad: true, stage: 'gpu' }];
  assert.deepEqual(lateTimeline(t, frames), { late: [[250, 'main'], [266, 'gpu']], marks: [[200, 'live:mount:app']] });
});

const freeze = (more) => ({ ms: 100, main: { busy: 5, tasks: [] }, stages: { gpu: 6 }, threads: {}, ...more });

test('a freeze waiting on a frame that just started says so', () => {
  const f = freeze({ waitedOnSurface: 6, surfaces: [{ kind: 'a frame', sink: 'FrameSinkId(8, 10)', times: 6 }], started: [{ ms: 190, what: 'live:mount:knowgraph' }], gpu: { busy: 100, raster: 2, composite: 1, shaders: 0 } });
  assert.match(verdict(f), /^waiting on a frame that started 190 ms before \(live:mount:knowgraph/);
});

test('a GPU verdict whose parts explain little says so', () => {
  const f = freeze({ gpu: { busy: 100, raster: 2, composite: 1, shaders: 0 } });
  assert.match(verdict(f), /^GPU busy 100 ms, 97 of it in nothing it names/);
  const g = freeze({ gpu: { busy: 100, raster: 60, composite: 20, shaders: 0 } });
  assert.match(verdict(g), /^GPU busy 100 ms: raster 60 ms/);
});

test('a base that reads unlike the last run of the same build says so', () => {
  const root = mkdtempSync(join(tmpdir(), 'fp-drift-'));
  mkdirSync(join(root, '.frameproof'));
  const ctx = { root, machine: { id: 'm' } };
  const build = { key: 'k' };
  const cell = (median) => [{ id: 'carousel/next@4x', typical: { base: median }, margin: 2 }];
  assert.deepEqual(baseDrift(ctx, { run: { id: 'r1' }, build, results: cell(31.5) }), {});
  assert.match(baseDrift(ctx, { run: { id: 'r2' }, build, results: cell(22) })['carousel/next@4x'], /read 22 here and 31.5 in r1/);
  assert.deepEqual(baseDrift(ctx, { run: { id: 'r3' }, build, results: cell(23) }), {});
});
