// calibrate: what this machine can see. Two parts, on one build:
//
//   A/A          the build against itself: the noise floor of each step, the margin `same` will need, and
//                how many repetitions a given effect takes. A claim of better or worse here is a false one.
//   sensitivity  the same, with a known cost injected in one side (a freeze a few frames long): it must be
//                found, or the margins are promises the tool can't keep.
//
// The result is kept per machine (.frameproof/calibration/<machine>.json) and used by compare for margins.
import { number, string } from '../cli/args.mjs';
import { planningSpread, repetitionsFor, smallestVisible } from '../core/stats.mjs';
import { round } from '../core/verdict.mjs';
import { ready } from '../session.mjs';
import { abSession } from './ab.mjs';
import { guard, openRun, readCalibration, scenariosFor, throttles, writeCalibration } from './_shared.mjs';

export default async function calibrate(ctx) {
  const f = ctx.flags;
  const stop = await guard(ctx);
  if (stop) return stop;
  const scenarios = await scenariosFor(ctx);
  const ths = throttles(f, [1, 4]);
  const ref = string(f, 'ref', 'worktree');
  const run = openRun(ctx, { command: 'calibrate', ref, scenarios: scenarios.map((s) => s.name), throttles: ths });
  const build = ready(ctx.config, ref, f);
  const minutes = number(f, 'minutes', 15);

  // A/A, with `same` held back so every look gathers data: two looks, 16 repetitions a build and cell.
  const aa = await abSession(ctx, { run, base: build, head: build, scenarios, throttles: ths, reps: 4, minutes: minutes * 0.6, looks: 2 });
  const cal = readCalibration(ctx);
  const date = new Date().toISOString();
  const cells = [];
  for (const r of aa.results) {
    const v = aa.raw[r.id];
    const all = [...v.a, ...v.b];
    if (all.length < 8) {
      cells.push({ cell: r.id, error: 'too few repetitions succeeded to calibrate', verdict: r.verdict, reason: r.reason });
      continue;
    }
    const spread = round(planningSpread(all), 2);
    const margin = Math.max(1, Math.ceil(2 * smallestVisible(spread, 32)) / 2);
    cal.cells[r.id] = { spread, margin, n: all.length, date, typical: r.typical?.base };
    cells.push({ cell: r.id, aa: r.verdict, spread, margin, typical: r.typical?.base, smallestVisible: { at24: round(smallestVisible(spread, 24), 1), at48: round(smallestVisible(spread, 48), 1) }, repetitionsForMargin: repetitionsFor(spread, margin) });
  }
  const falseClaims = aa.results.filter((r) => r.verdict === 'better' || r.verdict === 'worse');

  // Sensitivity: a freeze of (margin + 2) frames in head, which must come out worse.
  const vsync = 1000 / 60;
  const probe = Math.max(...cells.map((c) => c.margin ?? 2));
  const freezeMs = Math.round((probe + 2) * vsync);
  const sens = await abSession(ctx, { run, base: build, head: build, injectB: `freeze:${freezeMs}`, scenarios, throttles: ths, reps: 4, minutes: minutes * 0.4, looks: 2 });
  const found = sens.results.filter((r) => r.verdict === 'worse').length;
  cal.sensitivity = { date, injected: `freeze:${freezeMs}`, found, of: sens.results.length };
  cal.machine = ctx.machine;
  writeCalibration(ctx, cal);

  const ok = !falseClaims.length && found === sens.results.length;
  const summary = `${cells.length} cells calibrated on ${ctx.machine.id}. A/A: ${falseClaims.length ? `${falseClaims.length} false claim(s) (${falseClaims.map((r) => r.id).join(', ')}): rerun later, the machine may have been busy` : 'no false claim'}. A ${freezeMs} ms freeze was found as worse in ${found} of ${sens.results.length} cells${found < sens.results.length ? ': those margins are optimistic, raise them or add repetitions' : ''}.`;
  run.finish({ status: ok ? 'ok' : 'inconclusive', summary, cells, sensitivity: cal.sensitivity, aa: aa.results, probe: sens.results });
  return { status: ok ? 'ok' : 'inconclusive', summary, run: run.id, evidence: cells, next: [`frameproof freezes -s ${scenarios[0].name}`, `frameproof compare --base HEAD --head worktree -s ${scenarios.map((s) => s.name).join(',')}`] };
}
