// The one module that knows what a Chrome trace looks like. PipelineReporter and most of these event names
// are Chrome internals, not an API, so everything that depends on them stays here, and the fixtures in
// test/ pin it per Chrome version. Tested on Chrome 156.

/** The categories for each depth of measuring. `light` is what verdicts count on: the deeper ones cost the
    page something, so their frame counts are not the same counts. */
const LIGHT = ['cc', 'benchmark', 'blink.user_timing', 'devtools.timeline', 'disabled-by-default-devtools.timeline.frame'];
const WORK = [...LIGHT, 'viz', 'gpu', 'toplevel', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.stack', 'disabled-by-default-v8.cpu_profiler', 'v8.execute', 'v8'];
const FULL = [...WORK, 'disabled-by-default-devtools.timeline.invalidationTracking'];
export const CATEGORIES = { light: LIGHT, work: WORK, full: FULL };

/** The compositor's stages, and what each means when it is the longest in a late frame. */
export const STAGE = {
  BeginImplFrameToSendBeginMainFrame: 'main thread busy (the next frame could not start)',
  SendBeginMainFrameToCommit: 'main thread (producing the frame)',
  Commit: 'main thread (commit)',
  EndCommitToActivation: 'raster (before activation)',
  Activation: 'raster (activation)',
  EndActivateToSubmitCompositorFrame: 'compositor',
  SubmitCompositorFrameToPresentationCompositorFrame: 'GPU / display compositor',
  SubmitToReceiveCompositorFrame: 'GPU / display compositor',
  ReceiveCompositorFrameToStartDraw: 'GPU / display compositor',
  StartDrawToSwapStart: 'GPU (drawing)',
  Swap: 'GPU (swap)',
  SwapEndToPresentationCompositorFrame: 'presentation',
};
const MISSED = 'main thread (its update missed the frame; the compositor drew without it)';

export const SCRIPT = new Set(['FunctionCall', 'TimerFire', 'FireAnimationFrame', 'EventDispatch', 'EvaluateScript', 'v8.evaluateModule', 'FireIdleCallback', 'RunMicrotasks', 'v8.callFunction', 'v8.run']);
export const kindOf = (name) =>
  SCRIPT.has(name) ? 'script'
  : name === 'UpdateLayoutTree' ? 'style'
  : name === 'Layout' ? 'layout'
  : /^(Paint|PrePaint|Layerize|PaintImage|RasterTask|Decode Image|Commit|UpdateLayer)$/.test(name) ? 'paint'
  : /^(MinorGC|MajorGC|V8\.GC|BlinkGC|ThreadState::)/.test(name) ? 'gc'
  : /^(ParseHTML|ParseAuthorStyleSheet|v8\.compile|v8\.parseOnBackground|v8\.compileModule|CompileScript)$/.test(name) ? 'parse'
  : null;

/** Threads that sit in a task while they wait, or that belong to the tracing itself: never work. */
const NOT_WORK = /^(GpuVSyncThread|PerfettoTrace|MemoryInfra|Chrome_.*|ThreadPoolServiceThread|CacheThread.*|swapper)$/;

/** Reads the parts everything else needs, once. */
export function readTrace(events, mainFrame) {
  const threadName = new Map();
  const processName = new Map();
  const byThread = new Map();
  const docs = new Map();
  const pidVotes = new Map();
  let actTs = null;
  for (const e of events) {
    if (e.ph === 'M') {
      if (e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args.name);
      else if (e.name === 'process_name') processName.set(e.pid, e.args.name);
      continue;
    }
    const d = e.args?.data;
    if ((d?.frame ?? e.args?.beginData?.frame) === mainFrame) pidVotes.set(e.pid, (pidVotes.get(e.pid) ?? 0) + 1);
    if (e.name === 'TracingStartedInBrowser') for (const f of d?.frames ?? []) docs.set(f.frame, { url: f.url, pid: f.processId, parent: f.parent });
    if ((e.name === 'FrameCommittedInBrowser' || e.name === 'CommitLoad') && d?.frame && d?.url) docs.set(d.frame, { url: d.url, pid: d.processId ?? e.pid, parent: d.parent });
    if (e.name === 'perf:act' && actTs === null) actTs = e.ts;
    if (e.ph === 'X') {
      const key = `${e.pid}:${e.tid}`;
      let list = byThread.get(key);
      if (!list) byThread.set(key, (list = []));
      list.push(e);
    }
  }
  // A page at rest may do nothing that names its frame: the browser's own record of the frame says where it is.
  if (!pidVotes.size && docs.get(mainFrame)?.pid !== undefined) pidVotes.set(docs.get(mainFrame).pid, 1);
  if (!pidVotes.size) throw new Error("no event in the trace names the page's main frame");
  const pagePid = [...pidVotes].sort((a, b) => b[1] - a[1])[0][0];
  const ours = new Set(pidVotes.keys());
  for (const list of byThread.values()) list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const tidOf = (pid, name) => [...threadName].find(([k, v]) => k.startsWith(`${pid}:`) && v === name)?.[0];
  const gpuPid = [...processName].find(([, v]) => v === 'GPU Process')?.[0];
  return {
    events, threadName, processName, byThread, docs, pagePid, ours, actTs, gpuPid, mainFrame,
    pageMain: tidOf(pagePid, 'CrRendererMain'),
    gpuMain: gpuPid !== undefined ? tidOf(gpuPid, 'CrGpuMain') : null,
    docName(f) {
      if (f === mainFrame) return 'page';
      const u = docs.get(f)?.url ?? '';
      if (!u) return '?';
      try {
        const url = new URL(u, 'http://x');
        const main = docs.get(mainFrame)?.url;
        return main && new URL(main).origin === url.origin ? url.pathname.replace(/\/$/, '') || '/' : url.host;
      } catch {
        return u.slice(0, 60);
      }
    },
  };
}

/** The frames the page's compositor reported, oldest first, from the step's own mark on. */
export function readFrames(t) {
  const open = new Map();
  const spans = [];
  const list = t.events.filter((e) => (e.ph === 'b' || e.ph === 'e') && t.ours.has(e.pid) && e.cat?.includes('benchmark')).sort((a, b) => a.ts - b.ts);
  for (const e of list) {
    const id = e.id2?.local ?? e.id;
    const k = `${id}:${e.name}`;
    if (e.ph === 'b') open.set(k, e);
    else {
      const b = open.get(k);
      if (!b) continue;
      open.delete(k);
      spans.push({ name: e.name, id, ts: b.ts, end: e.ts, args: b.args });
    }
  }
  const stagesOf = new Map();
  for (const s of spans) if (s.name !== 'PipelineReporter') (stagesOf.get(s.id) ?? stagesOf.set(s.id, []).get(s.id)).push(s);
  const act = t.actTs ?? -Infinity;
  return spans
    .filter((s) => s.name === 'PipelineReporter' && s.args?.frame_reporter && s.ts >= act)
    .map((s) => {
      const fr = s.args.frame_reporter;
      // Presented in full is on time whatever else it says; anything else that hurt smoothness is late.
      const bad = !!fr.affects_smoothness && fr.state !== 'STATE_PRESENTED_ALL' && fr.state !== 'STATE_NO_UPDATE_DESIRED';
      let stage = null;
      if (bad) {
        if (fr.state === 'STATE_DROPPED') {
          let worst = null;
          for (const st of stagesOf.get(s.id) ?? []) if (st.ts >= s.ts && st.end <= s.end && STAGE[st.name] && (!worst || st.end - st.ts > worst.end - worst.ts)) worst = st;
          stage = worst ? STAGE[worst.name] : 'unknown';
        } else stage = MISSED;
      }
      return { ts: s.ts, end: s.end, state: fr.state, bad, stage };
    })
    .sort((a, b) => a.ts - b.ts);
}

/** Late frames grouped into runs: each next one within a frame and a half of the last. */
export function frameRuns(frames, vsyncMs) {
  const runs = [];
  for (const f of frames) {
    if (!f.bad) continue;
    const last = runs.at(-1);
    if (last && f.ts - last.at(-1).ts <= vsyncMs * 1500) last.push(f);
    else runs.push([f]);
  }
  return runs;
}

/** What a step's frames come to: what verdicts count. */
export function countFrames(frames, vsyncMs) {
  const causes = {};
  let dropped = 0;
  let partial = 0;
  for (const f of frames) {
    if (!f.bad) continue;
    if (f.state === 'STATE_DROPPED') dropped++;
    else partial++;
    causes[f.stage] = (causes[f.stage] ?? 0) + 1;
  }
  const runs = frameRuns(frames, vsyncMs);
  return {
    frames: frames.length,
    presented: frames.filter((f) => f.state === 'STATE_PRESENTED_ALL' || f.state === 'STATE_PRESENTED_PARTIAL').length,
    late: dropped + partial,
    dropped,
    partial,
    causes,
    longestFreezeMs: Math.round(Math.max(0, ...runs.map((r) => r.length * vsyncMs))),
  };
}

const TOP = new Set(['RunTask', 'ThreadPool_RunTask']);

/** The time each working thread spent in tasks between two timestamps, by what the thread is. */
export function threadTime(t, from = -Infinity, to = Infinity, place) {
  const rows = [];
  for (const [key, list] of t.byThread) {
    const name = t.threadName.get(key) ?? '?';
    if (NOT_WORK.test(name)) continue;
    const pid = Number(key.split(':')[0]);
    const proc = t.processName.get(pid) ?? '?';
    if (proc === 'Browser') continue;
    let ms = 0;
    let end = -Infinity;
    for (const e of list) {
      if (!TOP.has(e.name) || e.ts < end) continue;
      end = e.ts + e.dur;
      ms += Math.max(0, Math.min(to, end) - Math.max(from, e.ts)) / 1000;
    }
    if (ms < 0.5) continue;
    rows.push({ thread: threadLabel(t, key, name, pid, list, place), ms: +ms.toFixed(1) });
  }
  const merged = {};
  for (const r of rows) merged[r.thread] = +((merged[r.thread] ?? 0) + r.ms).toFixed(1);
  return merged;
}

function threadLabel(t, key, name, pid, list, place) {
  if (key === t.pageMain) return 'main';
  if (key === t.gpuMain) return 'gpu';
  if (name === 'VizCompositorThread') return 'gpu:display-compositor';
  if (pid === t.gpuPid) return 'gpu:other';
  if (/Worker thread$/.test(name)) {
    // A worker is named by the script it runs, which outlives the blob: or hashed url it came from.
    const call = list.find((e) => e.name === 'FunctionCall' && e.args?.data?.url);
    const d = call?.args?.data;
    const kind = name.replace(' thread', '').replace('Dedicated', '').toLowerCase() || 'worker';
    if (!d) return `${kind}:(unnamed)`;
    const file = place ? place({ url: d.url, lineNumber: d.lineNumber, columnNumber: d.columnNumber, functionName: d.functionName }).file : d.url;
    return `${kind}:${String(file).replace(/^blob:.*/, '(blob)')}`;
  }
  if (t.ours.has(pid)) return name === 'Compositor' ? 'compositor' : name === 'CrRendererMain' ? 'main' : 'raster';
  if (name === 'CrRendererMain') {
    const site = [...t.docs.values()].find((d) => d.pid === pid)?.url;
    try {
      const host = site ? new URL(site).host : '';
      // A renderer with no site of its own (a blank tab, a spare process) is no other site's.
      return host ? `other-site:${host}` : 'other-renderer';
    } catch {
      return 'other-renderer';
    }
  }
  return `other:${name}`;
}

/** V8's samples, per thread: [{ key, nodes, samples: [{ t, id, ms }] }]. Workers have a profile of their own. */
export function readProfiles(t) {
  const out = [];
  for (const prof of t.events.filter((e) => e.name === 'Profile')) {
    const key = `${prof.pid}:${prof.tid}`;
    const chunks = t.events.filter((e) => e.name === 'ProfileChunk' && e.pid === prof.pid && e.id === prof.id).sort((a, b) => a.ts - b.ts);
    const start = prof.args?.data?.startTime;
    if (!chunks.length || start === undefined) continue;
    const nodes = new Map();
    const samples = [];
    let time = start;
    for (const c of chunks) {
      const p = c.args?.data?.cpuProfile ?? {};
      for (const n of p.nodes ?? []) nodes.set(n.id, n);
      const deltas = c.args?.data?.timeDeltas ?? [];
      (p.samples ?? []).forEach((id, i) => {
        time += deltas[i] ?? 0;
        samples.push({ t: time, id, ms: (deltas[i + 1] ?? deltas[i] ?? 0) / 1000 });
      });
    }
    out.push({ key, nodes, samples });
  }
  return out;
}

const IDLE = new Set(['(idle)', '(program)', '(root)']);
/** WebGL calls that wait for the GPU process to link or compile. */
export const SHADER_CALL = /^(getProgramParameter|getShaderParameter|linkProgram|compileShader|getProgramInfoLog|getActiveUniform|getUniformLocation|getAttribLocation|useProgram)$/;

/** A sample's own place: a function with a location, or a native call charged to its caller. */
export function samplePlace(profile, id, placeTrace) {
  const n = profile.nodes.get(id);
  const f = n?.callFrame;
  if (!f || IDLE.has(f.functionName)) return null;
  if (f.functionName === '(garbage collector)') return { where: '(garbage collector)', native: false };
  const at = (c) => placeTrace({ url: c.url, lineNumber: c.lineNumber + 1, columnNumber: c.columnNumber + 1, functionName: c.functionName }).where;
  if (f.url) return { where: at(f), native: false, fn: f.functionName };
  let p = n;
  while (p && !p.callFrame?.url) p = profile.nodes.get(p.parent);
  const c = p?.callFrame;
  return { where: `${f.functionName || '(native)'}${c ? ' <- ' + at(c) : ''}`, native: true, fn: f.functionName };
}

/** Which compositor surfaces the display waited on in a window: { 'FrameSinkId(5, 10)': times }. */
export function pendingSurfaces(t, from, to) {
  const out = {};
  for (const e of t.events) {
    if (e.name !== 'DisplayDamageTracker::HasPendingSurfaces' || !e.args?.has_pending_surfaces || e.ts < from || e.ts > to) continue;
    const sink = /FrameSinkId\((\d+), (\d+)\)/.exec(e.args.pending_surface_id ?? '');
    const key = sink ? sink[0] : '(unnamed surface)';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** What a surface is, as far as its id says: a sink id with the high bit set is one a renderer made for
    video or a canvas; the rest belong to a frame. */
export function surfaceKind(sink) {
  const m = /FrameSinkId\((\d+), (\d+)\)/.exec(sink);
  if (!m) return 'unknown';
  return Number(m[2]) >= 2 ** 31 ? 'a video or canvas layer' : 'a frame';
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Where the page's local subframes ran: the local origins whose frames had a process other than the
    page's (another local site, out of process) and the ones that shared it. Which local name a page is on
    can decide this, and with it what the page costs (ADR 0001 D1). */
export function modeOf(t) {
  const main = t.docs.get(t.mainFrame)?.url;
  let page = '';
  try {
    page = main ? new URL(main).host : '';
  } catch {}
  const apart = new Set();
  const together = new Set();
  for (const d of t.docs.values()) {
    if (!d.parent || !d.url) continue;
    let host;
    try {
      host = new URL(d.url).host;
    } catch {
      continue;
    }
    if (!LOCAL.test(host)) continue;
    (d.pid && d.pid !== t.pagePid && !t.ours.has(d.pid) ? apart : together).add(host);
  }
  return { page, apart: [...apart].sort(), together: [...together].sort() };
}

/** Each late frame's time from the step's act, and its stage; with the page's own marks in the step
    (ADR 0001 D7). Kept small: a stutter is many late frames, and their timing is what tells it apart. */
export function lateTimeline(t, frames, { max = 240 } = {}) {
  const act = t.actTs ?? frames[0]?.ts ?? 0;
  const late = frames.filter((f) => f.bad).slice(0, max).map((f) => [Math.round((f.ts - act) / 1000), f.stage]);
  const marks = t.events
    .filter((e) => e.cat?.includes('blink.user_timing') && e.pid === t.pagePid && e.ts >= act && typeof e.name === 'string' && !/^(perf:|fp\|)/.test(e.name))
    .sort((a, b) => a.ts - b.ts)
    .map((e) => [Math.round((e.ts - act) / 1000), e.name])
    .filter((m, i, all) => all.findIndex((x) => x[1] === m[1]) === i)
    .slice(0, 16);
  return { late, marks };
}
