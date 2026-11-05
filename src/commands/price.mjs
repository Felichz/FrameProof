// price: what a change would be worth before making it. The same build runs twice, alternated, the second
// time with the change injected: a stylesheet (`css:<rules>`, say `css:.hero{display:none}` to price the
// hero away), a script run before the page's own (`js:<file>`), or a known cost (`busy:<ms>`, `freeze:<ms>`).
import { number, string, UsageError } from '../cli/args.mjs';
import { ready } from '../session.mjs';
import { abSession, compact } from './ab.mjs';
import { appendJournal, baseDrift, guard, modeNote, openRun, scenariosFor, throttles } from './_shared.mjs';

export default async function price(ctx) {
  const f = ctx.flags;
  const inject = string(f, 'inject', null);
  if (!inject) throw new UsageError('price needs --inject css:<rules>, js:<file>, busy:<ms> or freeze:<ms>', ["frameproof price --inject 'css:.hero{display:none}' -s scroll"]);
  const stop = await guard(ctx);
  if (stop) return stop;
  const scenarios = await scenariosFor(ctx);
  // One speed unless asked: a second one doubled every price, for a cell nobody asked about (ADR 0001 D16).
  const ths = throttles(f, [1]);
  const ref = string(f, 'ref', 'worktree');
  const run = openRun(ctx, { command: 'price', ref, inject, scenarios: scenarios.map((s) => s.name), throttles: ths, note: string(f, 'note', null) });
  const build = ready(ctx.config, ref, f);
  const out = await abSession(ctx, { run, base: build, head: build, injectB: inject, scenarios, throttles: ths, reps: number(f, 'batch', 4), minutes: number(f, 'minutes', 20), looks: number(f, 'looks', 6) });
  const better = out.results.filter((r) => r.verdict === 'better').map((r) => `${r.id} ${r.effect.lateFrames}`);
  for (const [id, note] of Object.entries(baseDrift(ctx, { run, build, results: out.results }))) {
    const v = out.results.find((x) => x.id === id);
    v.reason = `${v.reason ?? ''}${v.reason ? '. ' : ''}${note}`;
  }
  const mode = modeNote(out.records);
  let summary = `${build.label} with ${inject} injected, against without: ${out.status}${better.length ? ` (${better.join(', ')} late frames a step)` : ''}. A price is an upper bound on what the change saves: the injection removes or adds exactly that, the real change may do less.${mode ? ` ${mode}.` : ''}`;
  if (out.lost) summary = `partial: ${out.lost}; what follows covers what was measured before. ${summary}`;
  run.finish({ status: out.status, summary, inject, cells: out.results });
  const journal = f['no-journal'] ? null : appendJournal(ctx, { kind: 'price', run: run.id, hypothesis: string(f, 'note', ''), change: `inject ${inject} on ${build.label}`, status: out.status, summary, cells: out.results });
  return { status: out.status, summary, run: run.id, evidence: out.results.map(compact), journal, next: out.status === 'better' ? ['make the real change, then: frameproof compare --base HEAD --head worktree -s ' + scenarios.map((s) => s.name).join(',')] : [`frameproof freezes -s ${scenarios[0].name}`] };
}
