// compare: did this change make frames better? Two builds alternate in one session; the verdict comes with
// its effect, its interval and its reason, and lands in the journal.
import { number, string, UsageError } from '../cli/args.mjs';
import { dirtyFiles, isGit } from '../builds.mjs';
import { repetitionsFor } from '../core/stats.mjs';
import { ready } from '../session.mjs';
import { abSession, compact } from './ab.mjs';
import { appendJournal, guard, openRun, readCalibration, scenariosFor, throttles } from './_shared.mjs';
import { affectedScenarios } from './affected.mjs';

export default async function compare(ctx) {
  const f = ctx.flags;
  const head = string(f, 'head', 'worktree');
  let base = string(f, 'base', null);
  if (!base) {
    if (isGit(ctx.root) && head === 'worktree' && dirtyFiles(ctx.root).length) base = 'HEAD';
    else throw new UsageError('compare needs --base (and --head, which defaults to the files as they are now)', ['frameproof compare --base HEAD --head worktree -s <scenario>', 'frameproof compare --base main --head HEAD -s <scenario>']);
  }
  const stop = await guard(ctx);
  if (stop) return stop;

  let scenarios;
  let chosen = 'asked';
  if (f.scenario) scenarios = await scenariosFor(ctx);
  else {
    const a = await affectedScenarios(ctx, base, head);
    if (!a.scenarios.length) throw new UsageError(`which scenarios? None is known to run the changed files${a.unknown.length ? ` (no coverage yet for ${a.unknown.join(', ')})` : ''}. Pass -s <name>.`, ['frameproof affected', 'frameproof scenario check <file>']);
    ctx.flags.scenario = a.scenarios;
    scenarios = await scenariosFor(ctx);
    chosen = `affected by the change (${a.scenarios.join(', ')})`;
  }
  const ths = throttles(f, [1, 4]);
  const run = openRun(ctx, { command: 'compare', base, head, scenarios: scenarios.map((s) => s.name), throttles: ths, note: string(f, 'note', null) });
  const a = ready(ctx.config, base, f);
  const b = ready(ctx.config, head, f);
  const same = a.key === b.key;
  const out = await abSession(ctx, { run, base: a, head: b, scenarios, throttles: ths, reps: number(f, 'batch', 4), minutes: number(f, 'minutes', 20), looks: number(f, 'looks', 6) });

  const summary = summarize(out, { base: a.label, head: b.label, same });
  const cal = readCalibration(ctx);
  const next = suggest(ctx, out, { base, head, scenarios, ths, cal });
  const result = { status: out.status, summary, base: a.label, head: b.label, cells: out.results, placements: out.placements, strata: out.strata, minutes: out.elapsedMin, scenariosChosen: chosen };
  run.finish(result);
  const journal = f['no-journal'] ? null : appendJournal(ctx, { kind: 'compare', run: run.id, hypothesis: string(f, 'note', ''), change: `${a.label} → ${b.label}`, status: out.status, summary, cells: out.results });
  return {
    status: out.status,
    summary,
    run: run.id,
    evidence: out.results.map(compact),
    next,
    window: out.placements.join('; '),
    journal: journal ?? undefined,
    rest: `frameproof show ${run.id} --full`,
  };
}

function summarize(out, { base, head, same }) {
  const by = (v) => out.results.filter((r) => r.verdict === v).map((r) => r.id);
  const parts = [];
  for (const v of ['worse', 'better', 'invalid', 'inconclusive', 'same']) {
    const ids = by(v);
    if (ids.length) parts.push(`${v}: ${ids.join(', ')}`);
  }
  const what = same ? `${head} against itself (A/A)` : `${head} against ${base}`;
  return `${what}, ${out.strata} strata in ${out.elapsedMin} min. ${parts.join('; ')}.${out.status === 'inconclusive' ? ' Not known: never read this as "no difference".' : ''}`;
}

function suggest(ctx, out, { base, head, scenarios, ths, cal }) {
  const next = [];
  const worst = out.results.find((r) => r.verdict === 'worse');
  if (worst) next.push(`frameproof freezes --ref ${head} -s ${worst.id.split('/')[0]} --throttle ${worst.throttle}`);
  const invalid = out.results.find((r) => r.verdict === 'invalid');
  if (invalid) next.push(`frameproof scenario check ${invalid.id.split('/')[0]}`);
  const unsure = out.results.filter((r) => r.verdict === 'inconclusive' && r.n);
  if (unsure.length) {
    const spread = Math.max(...unsure.map((r) => cal.cells[r.id]?.spread ?? 1));
    const margin = Math.min(...unsure.map((r) => r.margin));
    const need = repetitionsFor(spread, margin);
    const have = Math.max(...unsure.map((r) => r.n.base));
    const minutes = Math.ceil((out.elapsedMin / Math.max(1, have)) * need * 1.2);
    next.push(`frameproof compare --base ${base} --head ${head} -s ${[...new Set(unsure.map((r) => r.id.split('/')[0]))].join(',')} --throttle ${[...new Set(unsure.map((r) => r.throttle))].join(',')} --minutes ${Math.max(minutes, 10)}   (about ${need} repetitions a build to see ±${margin})`);
  }
  if (!Object.keys(cal.cells).length) next.push(`frameproof calibrate -s ${scenarios[0].name}   (margins here are the default ±${ctx.config.margin}, not this machine's)`);
  next.push(`frameproof report ${'$RUN'}`.replace('$RUN', 'latest'));
  return next.slice(0, 4);
}
