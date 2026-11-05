// Measuring: one block is one browser on one build, its scenarios repeated in fresh pages, each step traced
// on its own. A step that fails (its act throws, its `done` never comes true) is recorded with its kind and
// retried once from a fresh page; the run goes on either way. Under load a failure is often a slow run, and
// sometimes it is a real bug in the app, so it is kept, never thrown away with the repetitions before it.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { launch, sleep, vsyncOf } from './browser.mjs';
import { findFreezes, dossier } from './core/freezes.mjs';
import { reduceWork } from './core/ledger.mjs';
import { placer, scriptUrls, sourcesUsed } from './core/sourcemaps.mjs';
import { CATEGORIES, countFrames, lateTimeline, modeOf, readFrames, readProfiles, readTrace } from './core/trace.mjs';
import { dirOf, ensure } from './store.mjs';

const ACT_TIMEOUT = 20_000;
const T0 = Date.now();
const dbg = (what) => process.env.FRAMEPROOF_DEBUG && process.stderr.write(`  [${((Date.now() - T0) / 1000).toFixed(1)}s] ${what}\n`);
const DONE_TIMEOUT = 15_000;

/** Known costs and priced changes, added to every page of a block before its scripts run. */
async function applyInject(page, inject, root) {
  if (!inject) return;
  const [kind, ...rest] = inject.split(':');
  const value = rest.join(':');
  if (kind === 'css') {
    await page.evaluateOnNewDocument((css) => {
      const add = () => document.head.append(Object.assign(document.createElement('style'), { textContent: css, id: 'frameproof-inject' }));
      if (document.head) add();
      else document.addEventListener('DOMContentLoaded', add);
    }, value);
  } else if (kind === 'js') {
    const file = resolve(root, value);
    if (!existsSync(file)) throw new Error(`--inject js: no file at ${file}`);
    await page.evaluateOnNewDocument(readFileSync(file, 'utf8'));
  } else if (kind === 'busy') {
    // A known cost: every frame burns `ms` of the main thread for 600 ms after the step acts.
    await page.evaluateOnNewDocument((ms) => {
      window.__fpInject = () => {
        const end = performance.now() + 600;
        const spin = () => {
          const t = performance.now();
          while (performance.now() - t < ms);
          if (performance.now() < end) requestAnimationFrame(spin);
        };
        requestAnimationFrame(spin);
      };
    }, Number(value));
  } else if (kind === 'freeze') {
    // One long task, 50 ms after the step acts.
    await page.evaluateOnNewDocument((ms) => {
      window.__fpInject = () =>
        setTimeout(function frameproofInjectedFreeze() {
          const t = performance.now();
          while (performance.now() - t < ms);
        }, 50);
    }, Number(value));
  } else throw new Error(`--inject takes css:<rules>, js:<file>, busy:<ms> or freeze:<ms>, got "${inject}"`);
}

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, fail) => setTimeout(() => fail(Object.assign(new Error(`${what} took over ${ms / 1000} s`), { timeout: true })), ms))]);

/** `done` may wait (waitForSelector) or check (return true, false or a reason): it is asked until it says yes. */
async function waitDone(step, ctx, timeout) {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    let r;
    try {
      r = await withTimeout(Promise.resolve(step.done(ctx)), Math.max(200, end - Date.now()), 'done()');
    } catch (e) {
      if (e.timeout) break;
      last = e.message.split('\n')[0];
      await sleep(100);
      continue;
    }
    if (r !== false && r !== null && typeof r !== 'string') return null;
    last = typeof r === 'string' ? r : 'done() returned false';
    await sleep(100);
  }
  return { kind: 'timeout', reason: last ?? `done() never came true in ${timeout / 1000} s` };
}

function classify(e) {
  const m = e?.message?.split('\n')[0] ?? String(e);
  if (e?.timeout || /timeout|timed out/i.test(m)) return { kind: 'timeout', reason: m };
  if (/No element found|failed to find|not found|is not clickable|Node is detached|null/i.test(m)) return { kind: 'act-error', reason: m, hint: 'a selector found nothing, or the element was not ready: check the scenario, or whether the page changed' };
  return { kind: 'act-error', reason: m };
}

/**
 * One block. `plan` lists the scenarios and what to keep. Calls `onStep(record)` for every step measured or
 * failed, and returns the block's records.
 */
export async function runBlock({ config, build, served, plan, reps, throttle = 1, depth = 'light', inject = null, profile, warm = false, show = false, headless = false, onStep = () => {}, keep = 'none', run, tag = 'a', block = 0, coverage = false }) {
  const records = [];
  const covered = {};
  const places = placer({ dist: served.dist && build.out, base: served.base });
  dbg('launch');
  const { newPage, close, placement } = await launch({ profile, show, headless, viewport: config.viewport });
  dbg('launched');
  let vsync = null;
  try {
    // A new profile fills its caches first, unmeasured: once in a browser's life, not once a visit.
    if (warm) for (const s of plan) if (!s.journey) await repetition({ s, page: await newPage(), measure: false });
    for (let rep = 0; rep < reps; rep++) {
      for (const s of plan) {
        if (s.journey) {
          const page = await newPage();
          const r = await journey({ page, plan: plan.filter((x) => !x.journey), rep });
          await page.close().catch(() => {});
          records.push(r);
          onStep(r);
          continue;
        }
        let out = await repetition({ s, page: await newPage(), rep });
        if (out.coverage) covered[s.name] = [...new Set([...(covered[s.name] ?? []), ...out.coverage])];
        if (out.some((r) => !r.ok)) {
          // Once more from a fresh page: a slow run passes, a real failure fails again.
          const again = await repetition({ s, page: await newPage(), rep, retry: true });
          out = out.map((r, i) => (r.ok ? r : again[i]?.ok ? { ...again[i], retried: r.failure } : { ...r, retriedFailure: again[i]?.failure }));
        }
        for (const r of out) {
          records.push(r);
          onStep(r);
        }
      }
    }
  } finally {
    await close();
  }
  return { records, placement, vsync, coverage: covered };

  function context(page) {
    return { page, url: served.base + (config.path ?? '/'), base: served.base, state: {}, sleep };
  }

  async function prepare(page) {
    await applyInject(page, inject, config.root);
    // Long tasks as the page sees them, so a step can wait for a quiet page before it acts (ADR 0001 D9).
    await page.evaluateOnNewDocument(() => {
      window.__fpLong = [];
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__fpLong.push(e.startTime + e.duration);
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
    });
    if (!vsync) {
      await page.goto('about:blank');
      vsync = await vsyncOf(page);
    }
  }

  async function repetition({ s, page, rep, retry = false, measure = true }) {
    const ctx = context(page);
    const out = [];
    const base = { scenario: s.name, build: tag, block, rep, throttle, retry: retry || undefined };
    try {
      dbg(`${s.name} rep ${rep}: page`);
      await prepare(page);
      dbg('prepared');
      if (coverage) await Promise.all([page.coverage.startJSCoverage({ resetOnNavigation: false }), page.coverage.startCSSCoverage({ resetOnNavigation: false })]);
      try {
        await withTimeout(Promise.resolve(s.setup?.(ctx)), 60_000, 'setup()');
      } catch (e) {
        const f = { ...classify(e), kind: 'setup', reason: classify(e).reason };
        return s.steps.map((st) => ({ ...base, step: st.name, ok: false, failure: f }));
      }
      dbg('setup done');
      const cdp = await page.createCDPSession();
      if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      for (const st of s.steps) {
        const r = await step(page, ctx, st, measure, `${s.name}-${st.name}-${tag}${block}-r${rep ?? 'w'}`, s);
        out.push({ ...base, step: st.name, ...r });
        // A step that failed leaves the page somewhere the next step didn't plan for.
        if (!r.ok) {
          for (const rest of s.steps.slice(s.steps.indexOf(st) + 1)) out.push({ ...base, step: rest.name, ok: false, failure: { kind: 'skipped', reason: `step "${st.name}" before it failed` } });
          break;
        }
      }
      if (coverage) out.coverage = await collectCoverage(page);
      return out;
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** Waits until the page has had no long task for `ms` (up to `cap`), so work a setup started (a boot on
      a timer, an image decoding) isn't billed to the step. Says how long it waited, and whether the page
      was still busy when the step began. */
  async function quiet(page, ms = 500, cap = 3000) {
    const start = Date.now();
    for (;;) {
      const s = await page.evaluate((ms) => {
        const now = performance.now();
        const last = Math.max(0, ...(window.__fpLong ?? []));
        return { since: now - last, recent: (window.__fpLong ?? []).filter((t) => now - t < 1000).length, known: Array.isArray(window.__fpLong) };
      }, ms).catch(() => ({ since: Infinity, recent: 0, known: false }));
      if (!s.known || s.since >= ms) return { waitedMs: Date.now() - start };
      if (Date.now() - start >= cap) return { waitedMs: Date.now() - start, busy: s.recent };
      await sleep(100);
    }
  }

  async function step(page, ctx, st, measure, label, s = {}) {
    const q = st.quiet === false || s.quiet === false ? null : await quiet(page);
    await sleep(st.before ?? 400);
    // A tab in the background draws nothing: its step would count no frames and no work, which reads as a
    // perfect page. It is brought to the front, and if it stays hidden the step fails as such.
    if (!headless && !(await visible(page))) return { ok: false, ms: 0, failure: { kind: 'hidden', reason: 'the page was not visible (a background tab draws no frames), even after bringing it to the front' } };
    await page.tracing.start({ categories: CATEGORIES[depth] });
    // Starting the trace starts V8's sampling profiler, a task of its own on the main thread (25 ms seen):
    // the step acts once it's over, and a mark says where the step really begins.
    await sleep(depth === 'light' ? 120 : 300);
    await page.evaluate(() => performance.mark('perf:act')).catch(() => {});
    const t0 = Date.now();
    let failure = null;
    try {
      await withTimeout(Promise.resolve(st.act(ctx)), st.timeout ?? ACT_TIMEOUT, 'act()');
      if (inject && /^(busy|freeze):/.test(inject)) await page.evaluate(() => window.__fpInject?.()).catch(() => {});
      failure = await waitDone(st, ctx, st.doneTimeout ?? DONE_TIMEOUT);
    } catch (e) {
      failure = classify(e);
    }
    const ms = Date.now() - t0;
    dbg(`${st.name} done after ${ms} ms`);
    await sleep(st.settle ?? 1200);
    let events;
    try {
      const raw = await page.tracing.stop();
      events = JSON.parse(Buffer.from(raw).toString());
      events = events.traceEvents ?? events;
    } catch (e) {
      return { ok: false, ms, failure: failure ?? { kind: 'trace', reason: `the trace could not be read: ${e.message}` } };
    }
    if (failure) return { ok: false, ms, failure };
    dbg(`trace stopped, ${events.length} events`);
    if (!measure) return { ok: true, ms };
    const reduced = await reduce(events, page, label);
    dbg('reduced');
    return { ok: true, ms, ...reduced, ...(q?.busy ? { notQuiet: { waitedMs: q.waitedMs, longTasks: q.busy } } : {}) };
  }

  async function visible(page) {
    for (let i = 0; i < 6; i++) {
      const state = await page.evaluate(() => document.visibilityState).catch(() => 'unknown');
      if (state === 'visible') return true;
      await page.bringToFront().catch(() => {});
      await sleep(150);
    }
    return false;
  }

  async function reduce(events, page, label) {
    await places.prepare(scriptUrls(events));
    let t;
    try {
      t = readTrace(events, page.mainFrame()._id);
    } catch (e) {
      return { ok: false, failure: { kind: 'trace', reason: e.message } };
    }
    const frames = readFrames(t);
    const counts = countFrames(frames, vsync.ms);
    const out = { counts, episode: counts.longestFreezeMs >= config.episodeMs, vsyncMs: +vsync.ms.toFixed(2), mode: modeOf(t), timeline: lateTimeline(t, frames) };
    if (depth !== 'light') {
      out.freezes = findFreezes(t, frames, { vsyncMs: vsync.ms, minMs: 30, placeTrace: places.placeTrace });
      out.work = reduceWork(t, places.placeTrace);
    }
    if (keep === 'all' || (keep === 'freezes' && out.freezes?.length)) out.trace = run.keepTrace(label ?? `${tag}-${block}-${Date.now()}`, { mainFrame: page.mainFrame()._id, vsyncMs: vsync.ms, events });
    out.maps = places.coverage();
    return out;
  }

  /** The scenarios walked in order in one trace, from a fresh page, and every long task in it, wherever it
      falls: inside a step, in a setup, or between steps, where no scenario looks. */
  async function journey({ page, plan: list, rep }) {
    const ctx = context(page);
    await prepare(page);
    if (throttle > 1) await (await page.createCDPSession()).send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.tracing.start({ categories: CATEGORIES.work });
    await sleep(300);
    // Marks in the page land in the trace with the trace's own clock, across navigations.
    const mark = (label, edge) => page.evaluate((n) => performance.mark(n), `fp|${label}|${edge}`).catch(() => {});
    let failure = null;
    try {
      for (const s of list) {
        await mark(`${s.name} setup`, 'start');
        await withTimeout(Promise.resolve(s.setup?.(ctx)), 60_000, `${s.name} setup()`);
        await mark(`${s.name} setup`, 'end');
        for (const st of s.steps) {
          await sleep(400);
          await mark(`${s.name} ${st.name}`, 'start');
          await withTimeout(Promise.resolve(st.act(ctx)), st.timeout ?? ACT_TIMEOUT, 'act()');
          const f = await waitDone(st, ctx, st.doneTimeout ?? DONE_TIMEOUT);
          if (f) throw Object.assign(new Error(`${s.name} ${st.name}: ${f.reason}`), f);
          await sleep(st.settle ?? 1200);
          await mark(`${s.name} ${st.name}`, 'end');
        }
      }
    } catch (e) {
      failure = classify(e);
    }
    await sleep(800);
    const raw = await page.tracing.stop();
    let events = JSON.parse(Buffer.from(raw).toString());
    events = events.traceEvents ?? events;
    await places.prepare(scriptUrls(events));
    const t = readTrace(events, page.mainFrame()._id);
    const frames = readFrames(t);
    const record = { scenario: 'journey', step: 'walk', build: tag, block, rep, throttle, ok: !failure, failure: failure ?? undefined, counts: countFrames(frames, vsync.ms), vsyncMs: +vsync.ms.toFixed(2) };
    record.blocks = journeyBlocks(t, frames, places.placeTrace, vsync.ms);
    record.work = reduceWork(t, places.placeTrace);
    if (keep !== 'none') record.trace = run.keepTrace(`journey-${tag}${block}-r${rep}`, { mainFrame: page.mainFrame()._id, vsyncMs: vsync.ms, events });
    return record;
  }

  async function collectCoverage(page) {
    const [js, css] = await Promise.all([page.coverage.stopJSCoverage(), page.coverage.stopCSSCoverage()]);
    const files = new Set();
    for (const c of js) {
      if (!c.url.startsWith(served.base)) continue;
      const consumer = places.consumer(c.url);
      if (consumer) for (const f of sourcesUsed(consumer, c.text, c.ranges)) files.add(f);
      else if (c.ranges.length) files.add(urlToFile(c.url));
    }
    for (const c of css) if (c.url.startsWith(served.base) && c.ranges.length) files.add(urlToFile(c.url));
    return [...files].filter(Boolean);
  }

  function urlToFile(url) {
    try {
      const p = decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
      if (build.out && existsSync(join(build.out, p))) return relative(config.root, join(resolve(config.root, config.out ?? '.'), p)).replaceAll('\\', '/');
      return p;
    } catch {
      return null;
    }
  }
}

/** Long tasks on the page's main thread over a whole journey, each placed in the step or the gap it fell in. */
function journeyBlocks(t, frames, placeTrace, vsyncMs) {
  const main = t.byThread.get(t.pageMain) ?? [];
  const long = main.filter((e) => e.name === 'RunTask' && e.dur >= 50_000);
  const marks = t.events.filter((e) => typeof e.name === 'string' && e.name.startsWith('fp|')).sort((a, b) => a.ts - b.ts);
  const windows = [];
  for (const m of marks) {
    const [, label, edge] = m.name.split('|');
    if (edge !== 'start') continue;
    const end = marks.find((x) => x.ts >= m.ts && x.name === `fp|${label}|end`);
    windows.push({ label, from: m.ts, to: end?.ts ?? Infinity, setup: label.endsWith(' setup') });
  }
  const t0 = marks[0]?.ts ?? frames[0]?.ts ?? long[0]?.ts ?? 0;
  const profiles = readProfiles(t);
  return long
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 12)
    .map((task) => {
      const mid = task.ts + task.dur / 2;
      const w = windows.filter((x) => mid >= x.from && mid <= x.to).at(-1);
      const where = w ? (w.setup ? `during ${w.label} (no step measures it)` : `in step ${w.label}`) : 'between steps (no step measures it)';
      const d = dossier(t, [], { t0, vsyncMs, placeTrace, profiles, window: [task.ts, task.ts + task.dur] });
      return { at: Math.round((task.ts - t0) / 1000), ms: Math.round(task.dur / 1000), where, covered: !!w && !w.setup, verdict: d.verdict, detail: d.main.tasks[0]?.detail?.slice(0, 3), js: d.jsBy?.length ? d.jsBy.slice(0, 3) : d.js?.slice(0, 3), shaders: d.shaders ?? undefined, gpuWait: d.gpuWait ?? undefined };
    })
    .sort((a, b) => a.at - b.at);
}

// A key can name a url (url:https://...): a folder name keeps only what a path can hold, on any system.
const folderOf = (key) => key.replace(/[^A-Za-z0-9._-]+/g, '_');
export function profileDir(config, key) {
  return ensure(join(dirOf(config.root), 'profiles', folderOf(key)));
}
export const hasProfile = (config, key) => existsSync(join(dirOf(config.root), 'profiles', folderOf(key), 'Default'));
