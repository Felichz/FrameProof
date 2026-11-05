// ledger: what each step costs, counted instead of timed: style recalculated, layout walked, paint, script,
// frames and timers asked for, style and layout forced, time per thread. Counts move little with the load,
// so they hold budgets (`check`) and say where work went. They don't say whether frames got better: only
// `compare` does. Work that left one thread for another is reported as moved, not removed.
import { number, string } from '../cli/args.mjs';
import { accountWork, leastOf } from '../core/ledger.mjs';
import { blocks, coverageFile, ready } from '../session.mjs';
import { readJson, Run, writeJson } from '../store.mjs';
import { guard, openRun, scenariosFor } from './_shared.mjs';

const SHOWN = ['busyMs', 'scriptMs', 'styleMs', 'layoutMs', 'paintMs', 'gcMs', 'styleElements', 'layoutObjects', 'forced', 'rafs', 'timers'];

/** Runs the scenarios with counted work, and returns each step's runs and their least. */
export async function workRun(ctx, { run, scenarios, ref, n, throttle = 1 }) {
  const build = ready(ctx.config, ref, ctx.flags);
  const out = await blocks({ config: ctx.config, build, plan: scenarios, reps: n, throttle, depth: 'work', run, tag: 'ref', flags: ctx.flags, keep: 'none', coverage: true });
  const by = new Map();
  for (const r of out.records) {
    if (r.scenario === 'journey') continue;
    const k = `${r.scenario}/${r.step}`;
    const e = by.get(k) ?? { scenario: r.scenario, step: r.step, runs: [], failed: [] };
    if (r.ok && r.work) e.runs.push(r.work);
    else if (!r.ok) e.failed.push(r.failure);
    by.set(k, e);
  }
  for (const e of by.values()) {
    e.least = leastOf(e.runs.map((w) => w.totals));
    const threads = {};
    for (const w of e.runs) for (const [t, ms] of Object.entries(w.threads ?? {})) threads[t] = Math.min(threads[t] ?? Infinity, ms);
    e.threads = Object.fromEntries(Object.entries(threads).map(([t, ms]) => [t, +ms.toFixed(1)]));
  }
  // What each scenario runs, for `affected`.
  if (Object.keys(out.coverage ?? {}).length) {
    const file = coverageFile(ctx.config);
    const cov = readJson(file, {});
    for (const [s, files] of Object.entries(out.coverage)) cov[s] = { files, date: new Date().toISOString() };
    writeJson(file, cov);
  }
  return { build, steps: [...by.values()], mode: out.mode };
}

export default async function ledger(ctx) {
  const f = ctx.flags;
  const stop = await guard(ctx, { frames: false });
  if (stop) return stop;
  const scenarios = await scenariosFor(ctx);
  const ref = string(f, 'ref', 'worktree');
  const run = openRun(ctx, { command: 'ledger', ref, scenarios: scenarios.map((s) => s.name) });
  const { build, steps, mode } = await workRun(ctx, { run, scenarios, ref, n: number(f, 'n', 3) });
  const rows = steps.map((e) => ({ step: `${e.scenario}/${e.step}`, ...Object.fromEntries(SHOWN.map((k) => [k, e.least[k]]).filter(([, v]) => v)), threads: e.threads, failed: e.failed.length || undefined }));

  const against = string(f, 'against', null);
  let moves;
  if (against) {
    const old = Run.open(ctx.root, against)?.meta.result?.steps;
    if (old) {
      moves = steps.map((e) => {
        const o = old.find((x) => x.step === `${e.scenario}/${e.step}`);
        if (!o) return { step: `${e.scenario}/${e.step}`, note: 'not in the other run' };
        const delta = Object.fromEntries(SHOWN.map((k) => [k, +((e.least[k] ?? 0) - (o[k] ?? 0)).toFixed(1)]).filter(([, v]) => Math.abs(v) >= 1));
        return { step: `${e.scenario}/${e.step}`, delta, ...accountWork(o.threads ?? {}, e.threads) };
      });
    }
  }
  const summary = `Counted work on ${build.label}, the least of ${number(f, 'n', 3)} repetitions a step (a late load only ever adds). Counts say where work went, not whether frames improved: only compare judges that.${[mode.label, ctx.loadNote].filter(Boolean).map((x) => ` (${x})`).join('')}`;
  run.finish({ status: 'ok', summary, steps: rows, moves });
  return { status: 'ok', summary, run: run.id, evidence: moves ?? rows, next: [`frameproof query ${run.id} forced`, `frameproof query ${run.id} askers`, 'frameproof check'] };
}
