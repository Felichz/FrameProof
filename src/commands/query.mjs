// query: questions about a run, answered from what it kept, with source-mapped names. This is what an
// agent asks instead of opening a trace or writing a parser.
//
//   hot         self time by function, per thread
//   forced      style and layout forced from script, by source line
//   askers      who asks for frames (requestAnimationFrame) and timers, by source line
//   late        when the late frames fall after the step's act, by stage, with the page's marks: a stutter
//               of many slightly late frames, which no freeze names (ADR 0001 D7)
//   threads     time per thread: main, workers, compositor, raster, GPU, other sites
//   long-tasks  the longest freezes and journey blocks, with their verdicts
//   failures    the steps that failed, with their kind and reason
//   steps       late frames per step and repetition
import { string, UsageError } from '../cli/args.mjs';
import { Run } from '../store.mjs';

const WHAT = ['late', 'hot', 'forced', 'askers', 'threads', 'long-tasks', 'failures', 'steps'];

export default async function query(ctx) {
  let [id, what] = ctx.args;
  if (id && WHAT.includes(id) && !what) [id, what] = ['latest', id];
  if (!what || !WHAT.includes(what)) throw new UsageError(`query <run> <${WHAT.join('|')}>`, ['frameproof query latest forced']);
  const run = Run.open(ctx.root, id === 'latest' ? null : id);
  if (!run) throw new UsageError(`no run ${id}`, ['frameproof journal']);
  const sc = string(ctx.flags, 'scenario', null);
  const stp = string(ctx.flags, 'step', null);
  const steps = run.steps().filter((r) => (!sc || r.scenario === sc) && (!stp || r.step === stp));
  const withWork = steps.filter((r) => r.ok && r.work);
  const per = (n) => (withWork.length ? +(n / withWork.length).toFixed(1) : 0);
  const top = (o, k = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([where, v]) => ({ where, v }));
  const needWork = () => {
    if (withWork.length) return;
    const ran = [...new Set(run.steps().map((r) => r.scenario))];
    if ((sc || stp) && !steps.length) throw new UsageError(`${run.id} has no step ${[sc, stp].filter(Boolean).join(' ')}: it ran ${ran.join(', ') || 'nothing'}`, [`frameproof ledger -s ${sc ?? '<scenario>'}`]);
    const why = steps.length && steps.every((r) => !r.ok) ? 'every step of it failed' : `a ${run.meta.command} run counts frames, not work`;
    throw new UsageError(`${run.id} kept no counted work (${why})`, [`frameproof ledger -s ${sc ?? '<scenario>'}`, `frameproof freezes -s ${sc ?? '<scenario>'}`]);
  };
  let evidence;
  let summary;
  if (what === 'late') {
    const timed = steps.filter((r) => r.ok && r.timeline);
    if (!timed.length) throw new UsageError(`${run.id} kept no late-frame timeline${steps.length ? ' (a run from before ADR 0001)' : ''}`, [`frameproof freezes -s ${sc ?? '<scenario>'}`]);
    const BINS = [[0, 100], [100, 300], [300, 1000], [1000, Infinity]];
    const byCell = new Map();
    for (const r of timed) {
      const key = `${r.scenario} ${r.step}${r.throttle > 1 ? ` @${r.throttle}x` : ''}${r.build && r.build !== 'ref' ? ` ${r.build}` : ''}`;
      const c = byCell.get(key) ?? { reps: 0, bins: BINS.map(() => ({})), marks: {} };
      c.reps++;
      for (const [at, stage] of r.timeline.late) {
        const i = BINS.findIndex(([a, b]) => at >= a && at < b);
        // The stage's name without its explanation, to keep the output short.
        const st = String(stage).replace(/ \(.*\)$/, '');
        if (i >= 0) c.bins[i][st] = (c.bins[i][st] ?? 0) + 1;
      }
      for (const [at, name] of r.timeline.marks) (c.marks[name] ??= []).push(at);
      byCell.set(key, c);
    }
    const label = ([a, b]) => (b === Infinity ? `${a}+ ms` : `${a}-${b} ms`);
    evidence = [...byCell].map(([cell, c]) => ({
      cell,
      late: Object.fromEntries(
        c.bins
          .map((bin, i) => [label(BINS[i]), Object.entries(bin).sort((x, y) => y[1] - x[1]).map(([st, n]) => `${st} ${+(n / c.reps).toFixed(1)}`).join(', ')])
          .filter(([, v]) => v),
      ),
      marks: Object.entries(c.marks).slice(0, 8).map(([name, at]) => `${name}@${Math.round(at.reduce((x, y) => x + y, 0) / at.length)}`),
    }));
    const worst = evidence[0];
    summary = `Late frames a repetition, by time after the act and the stage that held them, over ${timed.length} steps${worst ? `; ${worst.cell}: ${Object.entries(worst.late).map(([k, v]) => `${k}: ${v}`).join('; ') || 'none'}` : ''}`;
  } else if (what === 'forced' || what === 'askers') {
    needWork();
    const sum = {};
    for (const r of withWork) for (const [k, n] of Object.entries(r.work[what])) sum[k] = (sum[k] ?? 0) + n;
    const list = top(sum).map((x) => ({ where: x.where, perStep: per(x.v) }));
    evidence = list;
    summary = list.length ? `${what === 'forced' ? 'Forced style and layout' : 'Frames and timers asked for'}, a step on average over ${withWork.length} steps: the most from ${list[0].where} (${list[0].perStep})` : `nothing ${what === 'forced' ? 'forced style or layout' : 'asked for frames or timers'} in ${withWork.length} steps`;
  } else if (what === 'hot') {
    needWork();
    const by = {};
    for (const r of withWork) for (const [thread, fns] of Object.entries(r.work.hot ?? {})) for (const [fn, ms] of Object.entries(fns)) ((by[thread] ??= {})[fn] = (by[thread][fn] ?? 0) + ms);
    evidence = Object.entries(by).map(([thread, fns]) => ({ thread, functions: top(fns, 6).map((x) => `${x.where} ${per(x.v)} ms`) }));
    summary = evidence.length ? `Self time a step, by thread, over ${withWork.length} steps. Hottest on ${evidence[0].thread}: ${evidence[0].functions[0]}` : 'no CPU profile in this run';
  } else if (what === 'threads') {
    needWork();
    const by = {};
    for (const r of withWork) for (const [t, ms] of Object.entries(r.work.threads ?? {})) by[t] = (by[t] ?? 0) + ms;
    evidence = top(by, 12).map((x) => ({ thread: x.where, msPerStep: per(x.v) }));
    summary = `Time in tasks a step, by thread, over ${withWork.length} steps`;
  } else if (what === 'long-tasks') {
    const list = [];
    for (const r of steps) {
      for (const f of r.freezes ?? []) list.push({ where: `${r.scenario} ${r.step} rep ${r.rep + 1}`, ms: f.ms, verdict: f.verdict });
      for (const b of r.blocks ?? []) list.push({ where: `journey: ${b.where}`, ms: b.ms, verdict: b.verdict });
    }
    evidence = list.sort((a, b) => b.ms - a.ms).slice(0, 10);
    summary = evidence.length ? `${list.length} freezes and long tasks; the longest ${evidence[0].ms} ms: ${evidence[0].verdict}` : 'no freeze or long task in this run';
  } else if (what === 'failures') {
    const failed = steps.filter((r) => !r.ok);
    evidence = failed.slice(0, 12).map((r) => ({ where: `${r.scenario} ${r.step}`, build: r.build, rep: r.rep + 1, kind: r.failure.kind, reason: r.failure.reason, hint: r.failure.hint }));
    const retried = steps.filter((r) => r.retried).length;
    summary = `${failed.length} of ${steps.length} steps failed${retried ? `, ${retried} more passed on a retry` : ''}`;
  } else {
    const cells = {};
    for (const r of steps) {
      const k = `${r.scenario}/${r.step}@${r.throttle}x ${r.build}`;
      (cells[k] ??= []).push(r.ok ? r.counts.late : 'x');
    }
    evidence = Object.entries(cells).map(([k, v]) => ({ cell: k, late: v.join(' ') }));
    summary = `late frames per repetition (x: failed), ${steps.length} steps`;
  }
  return { status: 'ok', summary, run: run.id, evidence, next: [`frameproof show ${run.id}`] };
}
