// show: one freeze's dossier (`show f1`, `show <run>/f1`), one section of it (`show f1 main`), or a run's
// result (`show <run>`). The handles come from `freezes`.
import { UsageError } from '../cli/args.mjs';
import { listRuns, Run } from '../store.mjs';

const SECTIONS = ['main', 'js', 'threads', 'gpu', 'surfaces', 'invalidations', 'marks', 'stages', 'shaders'];

export default async function show(ctx) {
  const [handle, section] = ctx.args;
  if (!handle) throw new UsageError('show what? A freeze (f1, or <run>/f1) or a run id', ['frameproof show f1', 'frameproof journal']);
  const m = /^(?:(.+?)[/:])?(f\d+)$/.exec(handle);
  if (!m) {
    const run = Run.open(ctx.root, handle === 'latest' ? null : handle);
    if (!run) throw new UsageError(`no run ${handle}`, ['frameproof journal']);
    return runView(run, ctx);
  }
  const [, runId, fid] = m;
  const run = runId ? Run.open(ctx.root, runId) : latestWith(ctx.root, (r) => r.result?.groups);
  if (!run?.meta.result?.groups) throw new UsageError(runId ? `run ${runId} has no freezes` : 'no freezes run yet', ['frameproof freezes -s <scenario>']);
  const g = run.meta.result.groups.find((x) => x.id === fid);
  if (!g) throw new UsageError(`${run.id} has freezes f1 to f${run.meta.result.groups.length}, not ${fid}`);
  const member = [...g.members].sort((a, b) => b.ms - a.ms)[0];
  const step = run.steps().find((r) => r.ok && r.scenario === g.scenario && r.step === g.step && r.rep === member.rep && (r.freezes ?? []).length);
  const d = step?.freezes?.filter((x) => x.ms >= (run.meta.result.min ?? 0))?.[member.index] ?? step?.freezes?.[member.index];
  if (!d) throw new UsageError(`the dossier of ${fid} is not in ${run.id}'s steps`);
  const head = { id: `${run.id}/${fid}`, where: `${g.scenario} ${g.step}`, in: `${g.in}/${g.of} repetitions`, ms: `${g.minMs}-${g.maxMs}`, verdict: d.verdict, at: `+${d.at} ms into the step`, frames: `${d.frames} late (${d.dropped} dropped, ${d.partial} shown in part)` };
  if (section) {
    if (!SECTIONS.includes(section)) throw new UsageError(`sections: ${SECTIONS.join(', ')}`);
    return { status: 'ok', summary: `${fid} ${section}: ${d.verdict}`, run: run.id, evidence: [{ ...head, [section]: d[section === 'js' ? 'js' : section] ?? null, ...(section === 'js' ? { jsBy: d.jsBy } : {}) }], next: [`frameproof show ${run.id}/${fid}`] };
  }
  const evidence = [head, { stages: d.stages }, { main: { busy: d.main.busy, top: d.main.tasks[0] } }, { js: d.jsBy?.length ? d.jsBy.slice(0, 4) : d.js.slice(0, 4) }];
  if (d.shaders) evidence.push({ shaders: d.shaders });
  if (Object.keys(d.threads ?? {}).length) evidence.push({ threads: d.threads });
  if (d.gpu) evidence.push({ gpu: d.gpu });
  if (d.surfaces?.length) evidence.push({ surfaces: d.surfaces });
  if (d.invalidations?.length) evidence.push({ invalidations: d.invalidations.slice(0, 4) });
  if (d.marks?.length) evidence.push({ marks: d.marks });
  return { status: 'ok', summary: `${fid} (${g.scenario} ${g.step}, ${g.in}/${g.of}): ${d.verdict}`, run: run.id, evidence, next: [`frameproof show ${run.id}/${fid} <${SECTIONS.join('|')}>`, `frameproof query ${run.id} forced`, `frameproof query ${run.id} hot`], rest: `frameproof show ${run.id}/${fid} <section> --full` };
}

function latestWith(root, test) {
  const meta = listRuns(root).find((r) => test(r));
  return meta ? Run.open(root, meta.id) : null;
}

function runView(run, ctx) {
  const m = run.meta;
  const r = m.result;
  const steps = run.steps();
  const failed = steps.filter((s) => !s.ok).length;
  const evidence = [{ command: m.command, state: m.state, started: m.started, finished: m.finished, steps: steps.length, failed, machine: m.machine?.id }];
  if (r?.cells) evidence.push(...r.cells.map((c) => ({ cell: c.id, verdict: c.verdict, effect: c.effect, typical: c.typical, episodes: c.episodes, n: c.n, reason: c.reason, margin: c.margin, marginFrom: c.marginFrom, firstRun: c.firstRun })));
  if (r?.groups) evidence.push(...r.groups.map((g) => ({ id: g.id, where: `${g.scenario} ${g.step}`, in: `${g.in}/${g.of}`, ms: `${g.minMs}-${g.maxMs}`, cause: g.example })));
  if (r?.steps && !r.cells) evidence.push(...r.steps);
  const status = r?.status && r.status !== 'ok' ? r.status : 'ok';
  return { status: m.state === 'running' ? 'ok' : status, summary: m.state === 'running' ? `${run.id} is still running: ${steps.length} steps measured so far` : (r?.summary ?? `${run.id}: ${m.command}`), run: run.id, machine: m.machine?.id ?? ctx.machine.id, evidence, next: m.state === 'running' ? [`frameproof wait ${run.id}`] : [`frameproof report ${run.id}`] };
}
