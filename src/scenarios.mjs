// Scenarios: what a person does on the page, in steps, each with an `act` and a `done`. `done` is required:
// it is how a step that did nothing is told apart from a step that was fast.
//
//   export default {
//     name: 'open-cart',
//     setup: async ({ page, url }) => page.goto(url),
//     steps: [
//       { name: 'open', act: ({ page }) => page.click('[data-cart]'), done: ({ page }) => page.waitForSelector('dialog[open]') },
//       { name: 'close', act: ({ page }) => page.keyboard.press('Escape'), done: ({ page }) => page.waitForSelector('dialog:not([open])') },
//     ],
//   };
//
// Built in, with no code: load, idle, scroll; and journey, which walks the others in one trace.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sleep } from './browser.mjs';

/** The element the page scrolls with under the middle of the viewport: an inner container, or the page. */
async function scrollerTop(page) {
  return page.evaluate(() => {
    const scrolls = (el) => {
      if (!el || el.scrollHeight <= el.clientHeight + 4) return false;
      const y = getComputedStyle(el).overflowY;
      return y === 'auto' || y === 'scroll' || el === document.scrollingElement;
    };
    let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (el && !scrolls(el)) el = el.parentElement;
    el ??= document.scrollingElement;
    window.__fpScroller = el;
    return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight };
  });
}
const readTop = (page) => page.evaluate(() => (window.__fpScroller ?? document.scrollingElement).scrollTop);
async function settleScroll(page, timeout = 4000) {
  let last = await readTop(page);
  const end = Date.now() + timeout;
  for (let still = 0; Date.now() < end && still < 3; ) {
    await sleep(120);
    const now = await readTop(page);
    still = Math.abs(now - last) < 1 ? still + 1 : 0;
    last = now;
  }
  return last;
}
async function wheel(page, dy) {
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await page.mouse.move(vp.w / 2, vp.h / 2);
  const ticks = 8;
  for (let i = 0; i < ticks; i++) {
    await page.mouse.wheel({ deltaY: dy / ticks });
    await sleep(16);
  }
}

export const BUILTIN = {
  load: {
    name: 'load',
    builtin: true,
    description: 'A fresh page loads the url: what the first seconds cost.',
    setup: async () => {},
    steps: [
      {
        name: 'load',
        act: ({ page, url }) => page.goto(url, { waitUntil: 'load', timeout: 60_000 }),
        done: ({ page }) => page.evaluate(() => document.readyState === 'complete'),
        settle: 2500,
      },
    ],
  },
  idle: {
    name: 'idle',
    builtin: true,
    description: 'The page at rest, with nothing touched: anything it draws or asks for is work nobody asked for.',
    setup: async ({ page, url }) => {
      await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
      await page.mouse.move(2, 2);
      await sleep(2500);
    },
    steps: [{ name: 'rest', act: async () => {}, done: async () => true, settle: 3000 }],
  },
  scroll: {
    name: 'scroll',
    builtin: true,
    description: 'Scroll down most of a screen with the wheel, then back up.',
    setup: async ({ page, url, state }) => {
      await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
      await sleep(1200);
      state.start = await scrollerTop(page);
      if (state.start.max < 50) throw new Error('the page does not scroll: nothing under the middle of the viewport, nor the page itself, is taller than the window');
    },
    steps: [
      {
        name: 'down',
        act: async ({ page }) => wheel(page, 700),
        done: async ({ page, state }) => ((await settleScroll(page)) > state.start.top + 50 ? true : 'the page did not scroll down'),
      },
      {
        name: 'up',
        act: async ({ page }) => wheel(page, -900),
        done: async ({ page, state }) => (Math.abs((await settleScroll(page)) - state.start.top) < 5 ? true : 'the page did not come back up'),
      },
    ],
  },
};

const FILE = /\.(m?js)$/;

export function scenarioFiles(config) {
  const dir = resolve(config.root, config.scenarios);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => FILE.test(f) && !f.startsWith('_'))
    .map((f) => join(dir, f));
}

export const fileHash = (file) => createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 10);

/** One scenario file, checked for shape. Returns { scenario } or { error }. */
export async function loadScenarioFile(file) {
  let mod;
  try {
    mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  } catch (e) {
    return { file, error: `it does not load: ${e.message.split('\n')[0]}` };
  }
  const s = mod.default;
  const problem = shapeProblem(s);
  if (problem) return { file, error: problem };
  return { file, scenario: { ...s, name: s.name ?? basename(file).replace(FILE, '').replace(/\.scenario$/, ''), file, hash: fileHash(file) } };
}

function shapeProblem(s) {
  if (!s || typeof s !== 'object') return 'it has no default export: `export default { name, setup, steps }`';
  if (!Array.isArray(s.steps) || !s.steps.length) return 'it has no steps: `steps: [{ name, act, done }]`';
  for (const [i, st] of s.steps.entries()) {
    const label = st?.name ? `step "${st.name}"` : `step ${i + 1}`;
    if (!st?.name) return `${label} has no name`;
    if (typeof st.act !== 'function') return `${label} has no act()`;
    if (typeof st.done !== 'function') return `${label} has no done(): it is required, so a step that did nothing isn't read as a fast one`;
  }
  const names = s.steps.map((x) => x.name);
  if (new Set(names).size !== names.length) return 'two steps share a name';
  if (s.setup && typeof s.setup !== 'function') return 'setup must be a function';
  return null;
}

/** Every scenario the project can run: its own files, then the built-in ones it doesn't redefine. */
export async function allScenarios(config) {
  const loaded = await Promise.all(scenarioFiles(config).map(loadScenarioFile));
  const ok = loaded.filter((x) => x.scenario).map((x) => x.scenario);
  const broken = loaded.filter((x) => x.error).map((x) => ({ file: relative(config.root, x.file), error: x.error }));
  const names = new Set(ok.map((s) => s.name));
  const builtins = Object.values(BUILTIN).filter((b) => !names.has(b.name));
  return { list: [...ok, ...builtins], own: ok, broken };
}

export async function pick(config, wanted) {
  const { list, broken } = await allScenarios(config);
  const out = [];
  const missing = [];
  for (const w of wanted) {
    if (w === 'journey') {
      out.push({ name: 'journey', builtin: true, journey: true });
      continue;
    }
    const byFile = existsSync(resolve(config.root, w)) ? (await loadScenarioFile(resolve(config.root, w))).scenario : null;
    const s = byFile ?? list.find((x) => x.name === w);
    if (s) out.push(s);
    else missing.push(w);
  }
  return { scenarios: out, missing, available: list.map((s) => s.name), broken };
}

/** `scenario(name, definition)`, for files that prefer to name it in a call. */
export function scenario(name, def) {
  return { name, ...def };
}
