// A build's cache key covers how it was built, and a build never outlives frameproof (ADR 0001 D3, D12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBuild } from '../src/builds.mjs';

test('the same files built with another environment are another build', () => {
  const root = mkdtempSync(join(tmpdir(), 'fp-key-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, '.gitignore'), 'dist/\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: root });
  const command = `node -e "require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/index.html', process.env.FLAVOR||'plain')"`;
  const a = prepareBuild({ root, build: { command, out: 'dist', env: {} } });
  const b = prepareBuild({ root, build: { command, out: 'dist', env: { FLAVOR: 'maps' } } });
  const again = prepareBuild({ root, build: { command, out: 'dist', env: {} } });
  assert.notEqual(a.key, b.key);
  assert.equal(a.key, again.key);
  assert.equal(again.cached, true);
});

test('a build ends when the process that started it is gone', async () => {
  const watchdog = fileURLToPath(new URL('../src/build-watchdog.mjs', import.meta.url));
  // A parent that doesn't exist: the watchdog ends the command within a second, not after 30 s.
  const started = Date.now();
  const w = spawn(process.execPath, [watchdog, String(2 ** 22 + 4321), 'sleep 30'], { stdio: 'ignore' });
  const code = await new Promise((done) => w.on('exit', done));
  assert.equal(code, 130);
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});
