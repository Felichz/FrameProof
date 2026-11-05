// The static server listens on the address it is given: the page's site decides which of its parts
// run in its own process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveBuild } from '../src/serve.mjs';

test('static on ::1 serves the build at an IPv6 base', async () => {
  const out = mkdtempSync(join(tmpdir(), 'fp-host-'));
  writeFileSync(join(out, 'index.html'), '<p>hi</p>');
  const s = await serveBuild({ serve: { static: true, host: '::1' } }, { out });
  try {
    assert.match(s.base, /^http:\/\/\[::1\]:\d+$/);
    assert.equal(await (await fetch(s.base + '/')).text(), '<p>hi</p>');
  } finally {
    await s.close();
  }
});
