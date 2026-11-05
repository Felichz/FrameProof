// What the reviews found misleading (ADR 0001): an argument that passed quietly, a dead run that read as
// running, a wait that gave up as `ok`, `--help` on a command, and which frameproof answered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Run } from '../src/store.mjs';

const bin = fileURLToPath(new URL('../bin/frameproof.mjs', import.meta.url));
const run = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, FRAMEPROOF_BUSY: '1.01' } });
  return { code: r.status, out: JSON.parse(r.stdout) };
};
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-contract-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><p>hi</p>');
  mkdirSync(join(dir, '.frameproof'), { recursive: true });
  return dir;
};

/** A finished freezes run with one group, written the way the store writes it. */
function freezesRun(dir) {
  const r = Run.create(dir, { command: 'freezes', argv: ['freezes', '-s', 'scroll'] });
  const dossier = { verdict: 'page main thread busy 120 ms: script', at: 10, frames: 7, dropped: 0, partial: 7, ms: 120, stages: {}, main: { busy: 120, tasks: [] }, js: [], threads: {} };
  r.addStep({ scenario: 'scroll', step: 'down', rep: 0, ok: true, freezes: [dossier] });
  r.finish({ status: 'ok', summary: 'one', min: 100, groups: [{ id: 'f1', scenario: 'scroll', step: 'down', in: 1, of: 1, minMs: 120, maxMs: 120, example: dossier.verdict, members: [{ rep: 0, index: 0, ms: 120 }] }] });
  return r;
}

test('show <run> <fN> is that freeze, not the run', () => {
  const dir = project();
  const r = freezesRun(dir);
  const out = run(dir, 'show', r.id, 'f1').out;
  assert.equal(out.status, 'ok');
  assert.equal(out.evidence[0].id, `${r.id}/f1`);
});

test('an argument a command would ignore is an error, and nothing runs', () => {
  const dir = project();
  const out = run(dir, 'journal', 'extra').out;
  assert.equal(out.status, 'error');
  assert.match(out.summary, /"extra" would be ignored/);
});

test('a run whose process is gone reads as stopped, not running', () => {
  const dir = project();
  const r = Run.create(dir, { command: 'compare', argv: ['compare', '-s', 'scroll'] });
  r.save({ pid: 2 ** 22 + 12345 }); // no such process
  r.addStep({ scenario: 'scroll', step: 'down', rep: 0, ok: true });
  assert.equal(r.state(), 'stopped');
  const out = run(dir, 'show', r.id).out;
  assert.equal(out.status, 'error');
  assert.match(out.summary, /stopped before it finished/);
});

test('a wait that runs out of time says running, not ok', () => {
  const dir = project();
  const r = Run.create(dir, { command: 'compare' });
  r.save({ pid: process.pid });
  const out = run(dir, 'wait', r.id, '--minutes', '0').out;
  assert.equal(out.status, 'running');
});

test('<command> --help prints its part of the guide, and every envelope names the tool', () => {
  const dir = project();
  const out = run(dir, 'freezes', '--help').out;
  assert.equal(out.status, 'ok');
  assert.match(out.text, /^# Freezes/m);
  assert.match(out.tool, /^frameproof \d+\.\d+\.\d+/);
});
