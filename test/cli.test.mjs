// The CLI's contract, with no browser: the envelope, exit codes, init, next's first states, guide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitCode, fit } from '../src/cli/envelope.mjs';
import { list, parseArgs } from '../src/cli/args.mjs';

const bin = fileURLToPath(new URL('../bin/frameproof.mjs', import.meta.url));
const run = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, FRAMEPROOF_BUSY: '1.01' } });
  return { code: r.status, out: JSON.parse(r.stdout), err: r.stderr };
};
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-test-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><p>hi</p>');
  return dir;
};

test('arguments: options, short names, lists', () => {
  const a = parseArgs(['compare', '--base', 'main', '-s', 'a,b', '-s', 'c', '--full', '--throttle=1,4']);
  assert.deepEqual(a._, ['compare']);
  assert.equal(a.flags.base, 'main');
  assert.deepEqual(list(a.flags, 'scenario'), ['a', 'b', 'c']);
  assert.deepEqual(list(a.flags, 'throttle'), ['1', '4']);
  assert.equal(a.flags.full, true);
});

test('exit codes follow the status', () => {
  assert.equal(exitCode('better'), 0);
  assert.equal(exitCode('inconclusive'), 0);
  assert.equal(exitCode('worse'), 1);
  assert.equal(exitCode('failed'), 1);
  assert.equal(exitCode('invalid'), 1);
  assert.equal(exitCode('not-measurable'), 2);
  assert.equal(exitCode('error'), 3);
});

test('the envelope is cut to its budget, and says so', () => {
  const env = { status: 'ok', summary: 's', run: 'r1', evidence: Array.from({ length: 80 }, (_, i) => ({ i, text: 'x'.repeat(60) })), next: ['a'] };
  const out = fit(env);
  assert.ok(JSON.stringify(out).length <= 1900);
  assert.ok(out.truncated.dropped > 0);
  assert.match(out.truncated.more, /show r1 --full/);
  assert.equal(fit(env, { full: true }).evidence.length, 80);
});

test('an unknown command is a usage error, exit 3', () => {
  const r = run(project(), 'nope');
  assert.equal(r.code, 3);
  assert.equal(r.out.status, 'error');
});

test('next on a bare project says init; init writes and overwrites nothing; next then asks for the goals', () => {
  const dir = project();
  assert.deepEqual(run(dir, 'next').out.next, ['frameproof init']);
  writeFileSync(join(dir, 'AGENTS.md'), '# Mine\n');
  const init = run(dir, 'init').out;
  assert.equal(init.status, 'ok');
  for (const f of ['frameproof.config.js', 'perf/GOALS.md', 'perf/JOURNAL.md', 'perf/budgets.js', '.gitignore']) assert.ok(existsSync(join(dir, f)), f);
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /^# Mine/);
  assert.match(agents, /frameproof:start/);
  const again = run(dir, 'init').out;
  assert.match(again.summary, /0 written/);
  const next = run(dir, 'next').out;
  assert.match(next.summary, /ask the person/);
  assert.ok(next.evidence[0].ask.length >= 3);
});

test('next sends to a scenario the goals name and nothing measures', () => {
  const dir = project();
  run(dir, 'init');
  writeFileSync(join(dir, 'perf/GOALS.md'), '# Goals\n\n## Which interactions matter most?\n\n1. `checkout`\n\n## What counts as a modest machine?\n\n- Throttle: 4x\n');
  assert.deepEqual(run(dir, 'next').out.next[0], 'frameproof scenario new checkout');
  const made = run(dir, 'scenario', 'new', 'checkout').out;
  assert.equal(made.status, 'ok');
  assert.ok(existsSync(join(dir, 'perf/scenarios/checkout.js')));
  assert.match(run(dir, 'next').out.next[0], /scenario check checkout/);
});

test('scenario list shows the built-in scenarios and a broken file', () => {
  const dir = project();
  run(dir, 'init');
  writeFileSync(join(dir, 'perf/scenarios/bad.js'), 'export default { steps: [{ name: "x", act() {} }] };');
  const out = run(dir, 'scenario', 'list').out;
  const names = out.evidence.map((e) => e.name).filter(Boolean);
  for (const b of ['load', 'idle', 'scroll']) assert.ok(names.includes(b), b);
  assert.match(out.evidence.find((e) => e.broken).broken, /no done\(\)/);
});

test('guide prints its topics, in full', () => {
  const out = run(project(), 'guide').out;
  assert.equal(out.status, 'ok');
  assert.ok(out.evidence[0].topics.includes('verdicts'));
  assert.match(run(project(), 'guide', 'verdicts').out.text, /Never "no difference"/);
});
