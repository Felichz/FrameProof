// Makes a golden trace from one a run kept: only the processes and threads the readers look at, gzipped.
// The fixtures pin the trace reader to a Chrome version (the one in each file's name); a new Chrome gets new
// fixtures next to the old ones, and the tests run on all of them.
//
//   node test/fixtures/make.mjs <kept trace .json.gz> <name>
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { STAGE } from '../../src/core/trace.mjs';

const [src, name] = process.argv.slice(2);
if (!src || !name) throw new Error('make.mjs <kept trace .json.gz> <name>');
const kept = JSON.parse(gunzipSync(readFileSync(src)));
const { mainFrame, vsyncMs, events } = kept;
const threadName = new Map(events.filter((e) => e.ph === 'M' && e.name === 'thread_name').map((e) => [`${e.pid}:${e.tid}`, e.args.name]));
const procName = new Map(events.filter((e) => e.ph === 'M' && e.name === 'process_name').map((e) => [e.pid, e.args.name]));
const pagePids = new Set(events.filter((e) => (e.args?.data?.frame ?? e.args?.beginData?.frame) === mainFrame).map((e) => e.pid));
const gpuPid = [...procName].find(([, v]) => v === 'GPU Process')?.[0];
const keepThread = (e) => {
  const t = threadName.get(`${e.pid}:${e.tid}`);
  if (pagePids.has(e.pid)) return ['CrRendererMain', 'Compositor', undefined].includes(t) || /Worker/.test(t ?? '');
  if (e.pid === gpuPid) return t === 'CrGpuMain' || t === 'VizCompositorThread';
  return e.name === 'TracingStartedInBrowser' || e.name === 'FrameCommittedInBrowser';
};
// Only the events some reader looks at: the frames and their stages, the tasks and what ran in them, the
// marks, the profile, the GPU's waits. Scheduler plumbing and flow arrows go.
const STAGES = new Set(['PipelineReporter', ...Object.keys(STAGE)]);
const USED = /^(RunTask|ThreadPool_RunTask|FunctionCall|TimerFire|FireAnimationFrame|EventDispatch|EvaluateScript|v8\.evaluateModule|FireIdleCallback|RunMicrotasks|v8\.callFunction|v8\.run|UpdateLayoutTree|Layout|Paint|PrePaint|Layerize|PaintImage|RasterTask|Decode Image|Commit|UpdateLayer|MinorGC|MajorGC|V8\.GC.*|BlinkGC.*|ParseHTML|ParseAuthorStyleSheet|v8\.compile|v8\.compileModule|CompileScript|RequestAnimationFrame|TimerInstall|Profile|ProfileChunk|TracingStartedInBrowser|FrameCommittedInBrowser|CommitLoad|perf:act|DisplayDamageTracker::HasPendingSurfaces|GrShaderCache::store|RasterDecoderImpl::DoEndRasterCHROMIUM|SkiaOutputSurfaceImplOnGpu::FinishPaintRenderPass|CommandBufferProxyImpl::Wait.*|GpuChannelHost::Send|GLES2Implementation::.*|.*InvalidationTracking)$/;
const used = (e) => (e.cat?.includes('benchmark') && (e.ph === 'b' || e.ph === 'e') ? STAGES.has(e.name) : USED.test(e.name) || e.cat?.includes('blink.user_timing'));
const out = events.filter((e) => e.ph === 'M' || (used(e) && (keepThread(e) || e.cat?.includes('benchmark'))));
const file = fileURLToPath(new URL(`./${name}.json.gz`, import.meta.url));
writeFileSync(file, gzipSync(JSON.stringify({ mainFrame, vsyncMs, chrome: process.env.CHROME_VERSION ?? null, events: out })));
console.log(`${file}: ${out.length} of ${events.length} events`);
