// A page's inline scripts each carry their own map: a position in the page resolves through the script
// it falls in, at its offset inside that script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sourceMap from 'source-map-js';
import { placer } from '../src/core/sourcemaps.mjs';

const mapFor = (source, lines) => {
  const g = new sourceMap.SourceMapGenerator({ file: 'x.js' });
  lines.forEach(([gl, gc, ol], i) => g.addMapping({ generated: { line: gl, column: gc }, original: { line: ol, column: 0 }, source, name: `fn${i}` }));
  return g.toString();
};

test('inline scripts resolve through their own maps, the map found in the build when not beside the page', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'fp-inline-'));
  mkdirSync(join(dist, '_astro'));
  writeFileSync(join(dist, '_astro', 'a.js.map'), mapFor('src/components/A.astro', [[1, 0, 10], [1, 6, 12]]));
  writeFileSync(join(dist, '_astro', 'b.js.map'), mapFor('src/components/B.astro', [[1, 0, 30]]));
  // Two inline scripts on one line of the document, as Astro writes them.
  const html = `<html>\n<body><p>x</p><script type="module">var a=1;f()\n//# sourceMappingURL=a.js.map</script><script type="module">g()\n//# sourceMappingURL=b.js.map</script>\n</body></html>`;
  writeFileSync(join(dist, 'index.html'), html);
  const p = placer({ dist, base: 'http://h' });
  await p.prepare(['http://h/']);
  const pos = (needle) => {
    const off = html.indexOf(needle);
    const before = html.slice(0, off);
    return [before.split('\n').length - 1, off - (before.lastIndexOf('\n') + 1)];
  };
  assert.equal(p.place('http://h/', ...pos('var a')).where, 'src/components/A.astro:10 fn0');
  assert.equal(p.place('http://h/', ...pos('f()')).where, 'src/components/A.astro:12 fn1');
  assert.equal(p.place('http://h/', ...pos('g()')).where, 'src/components/B.astro:30 fn0');
  // Outside every inline script: the page's own position.
  assert.equal(p.place('http://h/', 0, 0).where, '/:1');
});
