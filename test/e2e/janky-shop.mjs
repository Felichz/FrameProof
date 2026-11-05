// The sample app's test, on a real Chrome: frameproof must find each planted cause, by its source file, and
// must not blame the red herring. With --compare it also fixes the forced layout and checks that compare
// calls the fix better at 4x.
//
//   npm run e2e [-- --compare]
//
// It needs a display and a free machine (about 6 minutes, 15 with --compare). The answers are in
// test/janky-shop/expected.json, outside the example, so an agent tested on the example can't read them.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const bin = here('../../bin/frameproof.mjs');
const expected = JSON.parse(readFileSync(here('../janky-shop/expected.json'), 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'janky-shop-'));
cpSync(here('../../examples/janky-shop'), dir, { recursive: true });

const fp = (...args) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    return { code: r.status, ...JSON.parse(r.stdout) };
  } catch {
    throw new Error(`frameproof ${args.join(' ')} printed no envelope:\n${r.stdout}`);
  }
};
const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });

console.log(`janky-shop in ${dir}`);
fp('init');
cpSync(here('../janky-shop/GOALS.md'), join(dir, 'perf/GOALS.md'));
cpSync(here('../janky-shop/open-cart.js'), join(dir, 'perf/scenarios/open-cart.js'));
git('init', '-q');
git('add', '-A');
git('-c', 'user.name=frameproof-e2e', '-c', 'user.email=e2e@localhost', 'commit', '-qm', 'janky shop');

const doctor = fp('doctor');
if (doctor.status !== 'ok') {
  console.log(`not measurable here: ${doctor.summary}`);
  process.exit(2);
}
const check = fp('scenario', 'check', 'open-cart');
const freezes = fp('freezes', '-s', 'journey,scroll,open-cart', '--throttle', '4', '-n', '2', '--full');
const budgets = fp('check');
const askers = fp('query', budgets.run, 'askers', '--scenario', 'idle');

const text = (x) => JSON.stringify(x);
const found = {
  'forced-layout-scroll': freezes.evidence.some((e) => /^scroll/.test(e.where ?? '') && /layout forced/.test(e.cause) && /sticky-header\.js/.test(e.cause)),
  'shader-link-on-arrival': freezes.evidence.some((e) => e.journey && /shaders|GPU process/.test(e.cause)),
  'whole-page-restyle': freezes.evidence.some((e) => /^open-cart/.test(e.where ?? '') && /style/.test(e.cause) && /cart\.js|elements/.test(e.cause)),
  'raf-never-rests': budgets.status === 'failed' && /ticker\.js/.test(text(askers.evidence)),
};
const blamed = freezes.evidence.filter((e) => /catalog\.js|formatPrices|JSON/.test(e.cause ?? '')).map((e) => e.cause);

const checks = [['scenario check passes', check.status === 'ok'], ...expected.planted.map((p) => [`found ${p.id} (${p.file})`, found[p.id]]), ['the red herring is not blamed', blamed.length === 0]];

if (process.argv.includes('--compare')) {
  // The fix: positions read once, widths written once a frame.
  writeFileSync(join(dir, 'src/sticky-header.js'), `export function followScroll(cards) {
  const list = [...cards];
  const badges = list.map((card) => card.querySelector('.badge'));
  let tops = null;
  let queued = false;
  const update = () => {
    queued = false;
    tops ??= list.map((card) => card.offsetTop);
    const y = scrollY + innerHeight;
    badges.forEach((badge, i) => (badge.style.width = (40 + Math.max(0, Math.min(30, (y - tops[i]) / 20))) + 'px'));
  };
  addEventListener('scroll', () => {
    if (!queued) requestAnimationFrame(update);
    queued = true;
  }, { passive: true });
}
`);
  const cmp = fp('compare', '-s', 'scroll', '--throttle', '4', '--minutes', '12', '--note', 'e2e: batch the reads and writes');
  checks.push(['compare calls the fix better on scroll at 4x', cmp.status === 'better']);
  console.log(cmp.summary);
}

for (const [what, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (blamed.length) console.log('blamed:', blamed);
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
