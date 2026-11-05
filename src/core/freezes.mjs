// Freezes, one by one. A count of late frames says how often the page stutters; a freeze of 80 ms is what a
// visitor feels, and each has its own cause. Every run of late frames long enough gets a dossier: the stage
// that held it, the page's main thread broken down to source lines, V8's samples, what invalidated style,
// other processes and threads, the surfaces the display waited on, and the GPU. Then a verdict for each, and
// the freezes grouped by cause across repetitions: what comes back every time, apart from what happened once.
import { frameRuns, kindOf, pendingSurfaces, readProfiles, samplePlace, SCRIPT, SHADER_CALL, surfaceKind, threadTime } from './trace.mjs';

function count(list) {
  const c = {};
  for (const x of list) c[x] = (c[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]));
}

const NOT_THE_PAGES = /^(navigationStart|fetchStart|requestStart|responseEnd|domLoading|domInteractive|domContentLoaded|domComplete|loadEvent|unloadEvent|redirect|connect|domain|secureConnection|perf:act)/;

export function findFreezes(t, frames, { vsyncMs, minMs = 30, placeTrace }) {
  if (!frames.length) return [];
  const t0 = frames[0].ts;
  const profiles = readProfiles(t);
  const out = [];
  for (const run of frameRuns(frames, vsyncMs)) {
    if (run.length * vsyncMs < minMs) continue;
    out.push(dossier(t, run, { t0, vsyncMs, placeTrace, profiles }));
  }
  return out;
}

/** Everything that ran between a and b: also used by `journey` for long tasks that no frame reported. */
export function dossier(t, run, { t0, vsyncMs, placeTrace, profiles, window: span }) {
  const a = span?.[0] ?? run[0].ts;
  const b = span?.[1] ?? Math.max(...run.map((f) => f.end));
  const overlap = (e) => Math.max(0, Math.min(b, e.ts + (e.dur ?? 0)) - Math.max(a, e.ts)) / 1000;
  const out = {
    at: Math.round((a - t0) / 1000),
    ms: Math.round(run.length ? run.length * vsyncMs : (b - a) / 1000),
    frames: run.length,
    dropped: run.filter((f) => f.state === 'STATE_DROPPED').length,
    partial: run.filter((f) => f.state !== 'STATE_DROPPED').length,
    stages: count(run.map((f) => f.stage)),
  };

  const main = t.byThread.get(t.pageMain) ?? [];
  const tasks = main.filter((e) => e.name === 'RunTask' && e.ts < b && e.ts + e.dur > a);
  out.main = { busy: Math.round(tasks.reduce((s, x) => s + overlap(x), 0)), tasks: [] };
  for (const task of [...tasks].sort((x, y) => y.dur - x.dur).slice(0, 4)) out.main.tasks.push(breakDown(t, task, main, t0, placeTrace));

  out.gpuWait = gpuWait(main, a, b, overlap);

  const js = samples(t, profiles, a, b, placeTrace);
  out.js = js.self;
  out.jsBy = js.by;
  out.shaders = js.shaders;

  const inv = {};
  for (const e of t.events) {
    if (!/InvalidationTracking$/.test(e.name) || e.ts < a - vsyncMs * 1000 || e.ts > b || e.pid !== t.pagePid) continue;
    const d = e.args?.data ?? {};
    const k = `${e.name.startsWith('Layout') ? 'layout' : 'style'}: ${d.nodeName ?? '?'} (${d.reason ?? (d.invalidationList ?? []).map((x) => x.classes?.join('.') ?? x.id ?? x.attribute ?? '').join(',')})${d.frame ? ' in ' + t.docName(d.frame) : ''}`;
    inv[k] = (inv[k] ?? 0) + 1;
  }
  out.invalidations = Object.entries(inv).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, n]) => `${n}x ${k}`);

  // Every other thread, with its time in the window: workers, the compositor, other sites, the GPU.
  const threads = threadTime(t, a, b, placeTrace);
  delete threads.main;
  out.threads = Object.fromEntries(Object.entries(threads).filter(([, ms]) => ms >= 4).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, ms]) => [k, Math.round(ms)]));

  const surfaces = pendingSurfaces(t, a, b);
  out.surfaces = Object.entries(surfaces).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([sink, times]) => ({ sink, times, kind: surfaceKind(sink) }));
  out.waitedOnSurface = Object.values(surfaces).reduce((s, n) => s + n, 0);

  if (t.gpuMain) {
    const g = t.byThread.get(t.gpuMain) ?? [];
    const sum = (re) => Math.round(g.filter((e) => re.test(e.name)).reduce((s, e) => s + overlap(e), 0));
    out.gpu = {
      busy: Math.round(g.filter((e) => e.name === 'RunTask').reduce((s, e) => s + overlap(e), 0)),
      shaders: g.filter((e) => e.name === 'GrShaderCache::store' && e.ts >= a && e.ts <= b).length,
      raster: sum(/^RasterDecoderImpl::DoEndRasterCHROMIUM$/),
      composite: sum(/^SkiaOutputSurfaceImplOnGpu::FinishPaintRenderPass$/),
      video: sum(/Video|Media|D3D11Video|VideoDecoder/),
    };
  }

  out.marks = t.events
    .filter((e) => e.cat?.includes('blink.user_timing') && e.pid === t.pagePid && e.ts >= a - 400e3 && e.ts <= b && !NOT_THE_PAGES.test(e.name))
    .map((e) => `${e.name}@${Math.round((e.ts - t0) / 1000)}`)
    .filter((v, i, all) => all.indexOf(v) === i)
    .slice(0, 6);

  out.verdict = verdict(out);
  return out;
}

// The page's main thread waiting on the GPU process: a WebGL call that needs an answer (a program's link
// status, a pixel read) blocks until the GPU process has done everything before it. V8's samples don't show
// it (the wait is in native code), the trace does.
const GPU_WAIT = /^(CommandBufferProxyImpl::WaitForGetOffset|CommandBufferProxyImpl::WaitForToken|CommandBufferProxyImpl::WaitSyncToken|GpuChannelHost::Send)/;
const GL_CALL = /^GLES2Implementation::(\w+)/;
const SHADER_GL = /^(GetProgramiv|GetShaderiv|GetProgramInfoLog|GetShaderInfoLog|LinkProgram|CompileShader|GetUniformLocation|GetAttribLocation|GetActiveUniform)$/;

function gpuWait(main, a, b, overlap) {
  let ms = 0;
  const calls = {};
  const stack = [];
  for (const e of main) {
    if (e.ts > b) break;
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
    if (GPU_WAIT.test(e.name) && e.ts + e.dur >= a && !stack.some((x) => GPU_WAIT.test(x.name))) {
      const w = overlap(e);
      ms += w;
      const gl = [...stack].reverse().map((x) => GL_CALL.exec(x.name)?.[1]).find(Boolean) ?? 'other';
      calls[gl] = (calls[gl] ?? 0) + w;
    }
    stack.push(e);
  }
  if (ms < 1) return null;
  const top = Object.entries(calls).sort((x, y) => y[1] - x[1]);
  const shaderMs = top.filter(([c]) => SHADER_GL.test(c)).reduce((s, [, v]) => s + v, 0);
  return { ms: Math.round(ms), shaderMs: Math.round(shaderMs), calls: Object.fromEntries(top.slice(0, 4).map(([c, v]) => [c, Math.round(v)])) };
}

/** One task, split into what ran in it. */
function breakDown(t, task, main, t0, placeTrace) {
  const inner = main.filter((e) => e !== task && e.ts >= task.ts && e.ts + e.dur <= task.ts + task.dur);
  const kinds = { script: 0, style: 0, layout: 0, paint: 0, gc: 0, parse: 0 };
  const detail = new Map();
  const stack = [];
  const own = (u) => u && !u.startsWith('pptr:');
  for (const e of inner) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
    const k = kindOf(e.name);
    const inScript = stack.some((s) => SCRIPT.has(s.name));
    const nested = stack.some((s) => kindOf(s.name) === k);
    if (k && !nested) {
      const ms = e.dur / 1000;
      kinds[k] += ms;
      // Work a script made happen is the script's time already: shown, not added twice.
      if (k !== 'script' && inScript) kinds.script -= ms;
      const d = e.args?.data ?? {};
      const bd = e.args?.beginData ?? {};
      const src = d.stackTrace?.[0] ?? bd.stackTrace?.[0] ?? (d.url ? d : null);
      let where = own(src?.url) ? placeTrace(src).where : null;
      // A timer, a frame callback or an event has no location of its own: the heaviest of the page's
      // functions under it does. (The first one is often a cheap listener that happens to run before the
      // one doing the work, and named a 440 ms click after it.)
      if (!where && k === 'script') {
        const fn = inner
          .filter((x) => x.ts >= e.ts && x.ts + x.dur <= e.ts + e.dur && (own(x.args?.data?.url) || (!x.args?.data?.url && x.args?.data?.functionName)))
          .reduce((best, x) => (!best || x.dur > best.dur ? x : best), null);
        const fd = fn?.args?.data;
        where = fd?.url ? placeTrace(fd).where : fd?.functionName || null;
      }
      const doc = t.docName(d.frame ?? bd.frame);
      const forced = k !== 'script' && inScript ? true : undefined;
      // Many small layouts forced from one line are one cause, however many times it ran.
      const key = `${k}|${where}|${forced}`;
      const row = detail.get(key) ?? { ms: 0, kind: k, times: 0, elements: 0, dirty: 0, total: 0, name: e.name, doc, where, forced };
      row.ms += ms;
      row.times++;
      row.elements += e.args?.elementCount ?? 0;
      row.dirty += bd.dirtyObjects ?? 0;
      row.total = Math.max(row.total, bd.totalObjects ?? 0);
      detail.set(key, row);
    }
    stack.push(e);
  }
  const what = (r) => {
    const times = r.times > 1 ? ` in ${r.times} passes` : '';
    if (r.kind === 'style') return `${r.elements} elements${times}`;
    if (r.kind === 'layout') return `${r.dirty} of ${r.total} objects${times}`;
    return r.name + times;
  };
  return {
    at: Math.round((task.ts - t0) / 1000),
    ms: Math.round(task.dur / 1000),
    kinds: Object.fromEntries(Object.entries(kinds).filter(([, v]) => v >= 0.5).map(([k, v]) => [k, Math.round(v)])),
    detail: [...detail.values()].filter((r) => r.ms >= 1).sort((x, y) => y.ms - x.ms).slice(0, 8).map((r) => ({ ms: +r.ms.toFixed(1), kind: r.kind, what: what(r), doc: r.doc, where: r.where, forced: r.forced })),
  };
}

/** V8's own samples in the window, on the page's main thread: what JavaScript really ran. */
function samples(t, profiles, a, b, placeTrace) {
  const prof = profiles.find((p) => p.key === t.pageMain);
  if (!prof) return { self: [], by: [], shaders: null };
  const self = {};
  const by = {};
  const ownOf = new Map();
  // The nearest of the code's own functions up the stack: a library's work charged to whoever asked for it.
  const own = (id) => {
    if (ownOf.has(id)) return ownOf.get(id);
    let w = null;
    for (let n = prof.nodes.get(id); n && !w; n = prof.nodes.get(n.parent)) {
      const c = n.callFrame;
      if (!c?.url) continue;
      const placed = placeTrace({ url: c.url, lineNumber: c.lineNumber + 1, columnNumber: c.columnNumber + 1, functionName: c.functionName });
      // The project's own code: mapped to a source, or served as it is written (no build), never a library.
      if (!placed.tool && !placed.file.includes('node_modules') && (placed.mapped || !/[.-][a-f0-9]{8,}\.m?js$|\.min\.js$/.test(placed.file))) w = placed.where;
    }
    ownOf.set(id, w);
    return w;
  };
  let shaderMs = 0;
  const shaderBy = {};
  for (const s of prof.samples) {
    if (s.t < a || s.t > b) continue;
    const p = samplePlace(prof, s.id, placeTrace);
    if (!p) continue;
    self[p.where] = (self[p.where] ?? 0) + s.ms;
    const o = own(s.id);
    if (o) by[o] = (by[o] ?? 0) + s.ms;
    if (p.native && SHADER_CALL.test(p.fn ?? '')) {
      shaderMs += s.ms;
      shaderBy[p.where] = (shaderBy[p.where] ?? 0) + s.ms;
    }
  }
  const top = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([w, ms]) => `${w} ${ms.toFixed(1)} ms`);
  return { self: top(self), by: top(by), shaders: shaderMs >= 1 ? { ms: Math.round(shaderMs), where: top(shaderBy).slice(0, 2) } : null };
}

/** One line: what held this freeze. The largest share of the window wins. */
export function verdict(f) {
  const window = f.ms;
  const top = f.main.tasks[0];
  const own = (f.jsBy?.[0] ?? '').replace(/ [\d.]+ ms$/, '');
  const row = (d) => `${d.kind}${d.forced ? ' forced' : ''} ${d.what}${d.where ? ' at ' + d.where : ''}${d.doc && d.doc !== 'page' && d.doc !== '?' ? ' in ' + d.doc : ''}`;
  const culprit = (task) => {
    if (!task) return '';
    // Style or layout a script forced is what made the script long: named first when it is a large part.
    const forced = task.detail.filter((d) => d.forced).sort((x, y) => y.ms - x.ms)[0];
    if (forced && forced.ms >= task.ms * 0.35) {
      const from = task.detail.find((d) => d.kind === 'script' && d.where && d.where !== forced.where)?.where;
      return `${row(forced)}${from ? `, from script at ${from}` : ''}`;
    }
    const d = task.detail[0];
    if (!d) return Object.entries(task.kinds).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'untraced work';
    // A script with no place of its own (a module's evaluation, a task) is named by where its time went.
    if (d.kind === 'script' && !d.where && own) return `script ${d.what}, most of it in ${own}`;
    // Style or layout of a frame, with no script under it: what invalidated it is the lead.
    const lead = (d.kind === 'style' || d.kind === 'layout') && !d.where ? f.invalidations?.find((x) => x.replace(/^\d+x /, '').startsWith(`${d.kind}:`)) : null;
    if (lead) return `${row(d)}, after ${lead.replace(/^\d+x /, '')}`;
    return row(d);
  };
  const other = Object.entries(f.threads ?? {}).filter(([k]) => k.startsWith('other-site:')).sort((x, y) => y[1] - x[1])[0];
  const surface = f.surfaces?.[0];
  const named = surface ? `${surface.kind}, ${surface.sink}` : "another frame's surface";
  if (f.shaders && f.shaders.ms >= window * 0.3) return `page main thread waiting on shaders ${f.shaders.ms} ms: ${f.shaders.where[0]?.replace(/ [\d.]+ ms$/, '')}`;
  if (f.gpuWait && f.gpuWait.ms >= window * 0.3) return `page main thread waiting on the GPU process ${f.gpuWait.ms} ms${f.gpuWait.shaderMs >= f.gpuWait.ms * 0.5 ? ' (linking shaders: ' + Object.keys(f.gpuWait.calls).filter((c) => SHADER_GL.test(c)).join(', ') + ')' : ` (${Object.keys(f.gpuWait.calls).join(', ')})`}${own ? ' at ' + own : ''}`;
  if (f.main.busy >= window * 0.5) return `page main thread busy ${f.main.busy} ms: ${culprit(top)}`;
  if (f.waitedOnSurface && other) return `waiting on ${other[0].replace('other-site:', '')}'s frame (${named}; its main thread busy ${other[1]} ms)`;
  if (f.gpu && f.gpu.busy >= window * 0.5) return `GPU busy ${f.gpu.busy} ms: ${f.gpu.shaders ? `${f.gpu.shaders} shaders compiled, ` : ''}raster ${f.gpu.raster} ms, composite ${f.gpu.composite} ms`;
  if (f.waitedOnSurface) return `waiting on ${named}`;
  if (f.main.busy >= window * 0.25) return `page main thread partly busy ${f.main.busy} ms: ${culprit(top)}`;
  return `no work held it on the main thread or the GPU (${Object.keys(f.stages)[0]})`;
}

/** The verdict without its numbers. */
export const causeKey = (v) => v.replace(/\d+(\.\d+)? ms/g, '# ms').replace(/\d+ (elements|of)/g, '# $1').replace(/of \d+ objects/, 'of # objects').replace(/ in \d+ passes/, '');

/** Freezes grouped by cause over repetitions: a cause in 4 of 4 is the page's, one in 1 of 4 may be the machine. */
export function groupFreezes(steps) {
  const groups = new Map();
  const reps = {};
  for (const s of steps) {
    const key = `${s.scenario} ${s.step}`;
    reps[key] = (reps[key] ?? 0) + 1;
    const seen = new Set();
    for (const f of s.freezes) {
      const cause = causeKey(f.verdict);
      const id = `${key}: ${cause}`;
      const g = groups.get(id) ?? { scenario: s.scenario, step: s.step, cause, in: 0, ms: [], example: f.verdict, members: [] };
      if (!seen.has(id)) g.in++;
      seen.add(id);
      g.ms.push(f.ms);
      g.members.push({ rep: s.rep, at: f.at, ms: f.ms, index: s.freezes.indexOf(f), trace: s.trace });
      groups.set(id, g);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, of: reps[`${g.scenario} ${g.step}`], minMs: Math.min(...g.ms), maxMs: Math.max(...g.ms), total: g.ms.reduce((x, y) => x + y, 0) }))
    .sort((a, b) => b.in / b.of - a.in / a.of || b.total - a.total)
    .map((g, i) => ({ id: `f${i + 1}`, ...g }));
}
