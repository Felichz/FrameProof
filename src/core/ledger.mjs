// The work ledger: what a step costs, counted instead of timed. Late frames move with the load; the work
// behind them (styles recalculated, layout objects walked, paints, script, timers and frames asked for)
// mostly doesn't. Counts say where work went, not whether frames improved: only `compare` judges a change.
import { readProfiles, samplePlace, SCRIPT, threadTime } from './trace.mjs';

export function reduceWork(t, placeTrace) {
  const totals = { scriptMs: 0, styleMs: 0, layoutMs: 0, paintMs: 0, gcMs: 0, busyMs: 0, styleElements: 0, layoutObjects: 0, styles: 0, layouts: 0, paints: 0, forced: 0, rafs: 0, timers: 0 };
  const forced = {};
  const askers = {};
  const from = t.actTs ?? -Infinity;
  const ask = (kind, e) => {
    const s = e.args?.data?.stackTrace?.[0];
    const where = s && !s.url?.startsWith('pptr:') ? placeTrace(s).where : t.docName(e.args?.data?.frame);
    askers[`${kind} ${where}`] = (askers[`${kind} ${where}`] ?? 0) + 1;
  };
  for (const e of t.events) {
    if (e.ts < from || `${e.pid}:${e.tid}` !== t.pageMain) continue;
    if (e.name === 'RequestAnimationFrame') {
      totals.rafs++;
      ask('rAF', e);
    } else if (e.name === 'TimerInstall') {
      totals.timers++;
      ask('timer', e);
    }
  }
  const list = (t.byThread.get(t.pageMain) ?? []).filter((e) => e.ts >= from);
  const stack = [];
  for (const e of list) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
    const ms = (e.dur ?? 0) / 1000;
    const inScript = stack.find((s) => SCRIPT.has(s.name));
    if (e.name === 'RunTask' && !stack.length) totals.busyMs += ms;
    if (SCRIPT.has(e.name) && !inScript) totals.scriptMs += ms;
    if (e.name === 'UpdateLayoutTree') {
      totals.styleMs += ms;
      totals.styles++;
      totals.styleElements += e.args?.elementCount ?? e.args?.data?.elementCount ?? 0;
    }
    if (e.name === 'Layout') {
      totals.layoutMs += ms;
      totals.layouts++;
      totals.layoutObjects += e.args?.beginData?.dirtyObjects ?? 0;
    }
    if ((e.name === 'UpdateLayoutTree' || e.name === 'Layout') && inScript) {
      // Style or layout run synchronously inside script: a read that forced it.
      totals.forced++;
      const s = [...stack].reverse().find((x) => SCRIPT.has(x.name) && (x.args?.data?.url || x.args?.data?.stackTrace));
      const d = s?.args?.data;
      const top = e.args?.beginData?.stackTrace?.[0];
      const where = top ? placeTrace(top).where : d?.url ? placeTrace(d).where : t.docName(d?.frame);
      const k = `${e.name === 'Layout' ? 'layout' : 'style'} ${where}`;
      forced[k] = (forced[k] ?? 0) + 1;
    }
    if (/^(Paint|PrePaint|Layerize|PaintImage|Rasterize)$/.test(e.name)) totals.paintMs += ms;
    if (e.name === 'Paint') totals.paints++;
    if (/^(MajorGC|MinorGC|V8\.GC)/.test(e.name)) totals.gcMs += ms;
    stack.push(e);
  }
  for (const k of Object.keys(totals)) if (k.endsWith('Ms')) totals[k] = +totals[k].toFixed(1);
  return { totals, forced, askers, threads: threadTime(t, from, Infinity, placeTrace), hot: hotFunctions(t, from, placeTrace) };
}

/** Self time by function on every thread that has a profile: { thread: { where: ms } }, top of each. */
function hotFunctions(t, from, placeTrace) {
  const out = {};
  for (const prof of readProfiles(t)) {
    const label = prof.key === t.pageMain ? 'main' : (t.threadName.get(prof.key) ?? prof.key).replace(' thread', '').toLowerCase();
    const fns = {};
    for (const s of prof.samples) {
      if (s.t < from) continue;
      const p = samplePlace(prof, s.id, placeTrace);
      if (p) fns[p.where] = (fns[p.where] ?? 0) + s.ms;
    }
    const top = Object.entries(fns).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, ms]) => [k, +ms.toFixed(1)]);
    if (top.length) out[label] = Object.fromEntries(top);
  }
  return out;
}

/** Each count's least over the repetitions: the work the step can't do without, where a late load only adds. */
export function leastOf(runs) {
  const least = {};
  for (const k of Object.keys(runs[0] ?? {})) least[k] = Math.min(...runs.map((r) => r[k]));
  return least;
}

const family = (thread) => (thread === 'main' ? 'main' : thread.split(':')[0] === 'gpu' || thread === 'gpu' ? 'gpu' : thread);

/**
 * Compares where work ran before and after, thread by thread, in ms per step. Time that leaves the main
 * thread while another thread gains is `moved`, not removed: the ledger of the original couldn't tell, and
 * a move to a worker looked like work gone.
 */
export function accountWork(before, after, { floor = 5 } = {}) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)].map(family));
  const add = (o) => Object.entries(o).reduce((m, [k, v]) => ({ ...m, [family(k)]: (m[family(k)] ?? 0) + v }), {});
  const a = add(before);
  const b = add(after);
  const gains = [];
  const losses = [];
  for (const n of names) {
    const d = (b[n] ?? 0) - (a[n] ?? 0);
    if (d >= floor) gains.push({ thread: n, ms: d });
    if (d <= -floor) losses.push({ thread: n, ms: -d });
  }
  const moved = [];
  const removed = [];
  for (const l of losses.sort((x, y) => y.ms - x.ms)) {
    let left = l.ms;
    for (const g of gains.sort((x, y) => y.ms - x.ms)) {
      if (left < floor || g.ms < floor) continue;
      const ms = Math.min(left, g.ms);
      moved.push({ from: l.thread, to: g.thread, ms: Math.round(ms) });
      left -= ms;
      g.ms -= ms;
    }
    if (left >= floor) removed.push({ from: l.thread, ms: Math.round(left) });
  }
  const added = gains.filter((g) => g.ms >= floor).map((g) => ({ to: g.thread, ms: Math.round(g.ms) }));
  return { moved, removed, added };
}
