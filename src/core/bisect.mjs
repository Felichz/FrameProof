// Bisect (ADR 0002): which of a set of candidates holds a scenario's frames. Pure: the search is given a
// `judge` that prices a set of candidates and says whether taking them away made the scenario better.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Shorthands on a selector, from the coarsest to the finest: what each takes away. */
export const SHORTHANDS = {
  hide: (sel) => ({ css: `${sel}{display:none!important}` }),
  invisible: (sel) => ({ css: `${sel}{visibility:hidden!important}` }),
  still: (sel) => ({ css: `${sel},${sel} *{animation:none!important;transition:none!important}` }),
  flat: (sel) => ({ css: `${sel},${sel} *{box-shadow:none!important;filter:none!important;mix-blend-mode:normal!important;background-image:none!important}` }),
  pause: (sel) => ({
    js: `(() => { const go = () => { for (const root of document.querySelectorAll(${JSON.stringify(sel)})) for (const v of root.matches('video, audio') ? [root] : root.querySelectorAll('video, audio')) { v.pause(); v.play = () => Promise.resolve(); v.autoplay = false; } }; new MutationObserver(go).observe(document, { childList: true, subtree: true }); document.addEventListener('DOMContentLoaded', go); go(); })();`,
  }),
  off: (name) => ({ js: `window.__frameproof = window.__frameproof || {}; (window.__frameproof.off = window.__frameproof.off || []).push(${JSON.stringify(name)});` }),
};

/** The finer shorthands `--refine` tries on a selector a `hide:` found. */
export const FINER = ['invisible', 'still', 'flat', 'pause'];

/** A candidate as what to inject: `css:<rules>`, `js:<file>` (read by the caller), or a shorthand. */
export function expand(candidate, readFile = () => '') {
  const i = candidate.indexOf(':');
  if (i < 0) throw new Error(`a candidate is kind:value (${Object.keys(SHORTHANDS).join(', ')}, css, js), got "${candidate}"`);
  const kind = candidate.slice(0, i);
  const value = candidate.slice(i + 1);
  if (kind === 'css') return { label: candidate, css: value };
  if (kind === 'js') return { label: candidate, js: readFile(value) };
  const make = SHORTHANDS[kind];
  if (!make) throw new Error(`no candidate kind "${kind}": ${Object.keys(SHORTHANDS).join(', ')}, css or js`);
  return { label: candidate, ...make(value) };
}

/** Several candidates as one injection: a script, run before the page's own, that adds their styles and
    runs their scripts. Written to `dir`; returns `js:<file>`. */
export function combine(candidates, dir, name) {
  const css = candidates.map((c) => c.css).filter(Boolean).join('\n');
  const js = candidates.map((c) => c.js).filter(Boolean).join('\n;\n');
  const style = css
    ? `(() => { const add = () => document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(css)}, id: 'frameproof-bisect' })); if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); })();`
    : '';
  const file = join(dir, `${name}.js`);
  writeFileSync(file, `${style}\n${js}\n`);
  return `js:${file}`;
}

const keyOf = (set) => set.map((c) => c.label).sort().join(' + ');

/**
 * The search. `judge(set)` resolves to { better, summary, ... } for taking `set` away. Returns
 * { explained, culprits, together, steps }: `explained` false when the whole set doesn't make it better;
 * `culprits` the single candidates that do; `together` the sets whose cost shows only as a whole.
 */
export async function bisect(candidates, judge, { maxSteps = 12, known = {} } = {}) {
  const steps = [];
  const cache = new Map(Object.entries(known));
  let budget = maxSteps;
  const price = async (set) => {
    const key = keyOf(set);
    if (cache.has(key)) return cache.get(key);
    if (budget-- <= 0) return { better: false, skipped: 'out of steps (--max-steps)' };
    const r = await judge(set, key);
    cache.set(key, r);
    steps.push({ set: key, ...r });
    return r;
  };
  const whole = await price(candidates);
  if (!whole.better) return { explained: false, culprits: [], together: [], steps, cache: Object.fromEntries(cache) };
  const culprits = [];
  const together = [];
  const search = async (set) => {
    if (set.length === 1) return void culprits.push(set[0]);
    const mid = Math.ceil(set.length / 2);
    const [a, b] = [set.slice(0, mid), set.slice(mid)];
    const [ra, rb] = [await price(a), await price(b)];
    if (ra.better) await search(a);
    if (rb.better) await search(b);
    // Neither half alone: the cost shows only with both away (two causes that cover for each other, or a
    // cost spread across them). Said, not guessed at.
    if (!ra.better && !rb.better) together.push(keyOf(set));
  };
  await search(candidates);
  return { explained: true, culprits, together, steps, cache: Object.fromEntries(cache) };
}

/** Commits between good and bad (oldest first, bad included): the first that makes it worse. */
export async function bisectCommits(commits, isBad, { maxSteps = 12 } = {}) {
  let lo = 0;
  let hi = commits.length - 1; // commits[hi] is bad
  const steps = [];
  while (lo < hi && steps.length < maxSteps) {
    const mid = Math.floor((lo + hi) / 2);
    const r = await isBad(commits[mid]);
    steps.push({ commit: commits[mid], ...r });
    if (r.bad) hi = mid;
    else lo = mid + 1;
  }
  return { first: lo === hi ? commits[lo] : null, steps };
}
