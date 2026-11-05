// freezes: what exactly froze, and why. Each run of late frames long enough gets a dossier (the stage that
// held it, the main thread broken down to source lines, V8's samples, other threads, surfaces, the GPU) and
// a verdict; the freezes are grouped by cause across repetitions, what comes back every time first.
import { number, string } from '../cli/args.mjs';
import { groupFreezes } from '../core/freezes.mjs';
import { blocks, ready } from '../session.mjs';
import { guard, openRun, scenariosFor, throttles } from './_shared.mjs';

export default async function freezes(ctx) {
  const f = ctx.flags;
  const stop = await guard(ctx);
  if (stop) return stop;
  const scenarios = await scenariosFor(ctx);
  const ref = string(f, 'ref', 'worktree');
  const [throttle] = throttles(f, [1]);
  const n = number(f, 'n', 4);
  const min = number(f, 'min', 50);
  const run = openRun(ctx, { command: 'freezes', ref, scenarios: scenarios.map((s) => s.name), throttle, n, min });
  const build = ready(ctx.config, ref, f);
  const { records, placement, mode } = await blocks({ config: ctx.config, build, plan: scenarios, reps: n, throttle, depth: 'full', run, tag: 'ref', flags: f, keep: f.keep ? 'all' : 'freezes' });

  const measured = records.filter((r) => r.ok && r.scenario !== 'journey');
  const steps = measured.map((r) => ({ scenario: r.scenario, step: r.step, rep: r.rep, trace: r.trace, freezes: (r.freezes ?? []).filter((x) => x.ms >= min) }));
  const groups = groupFreezes(steps);
  const journeys = records.filter((r) => r.scenario === 'journey');
  const failed = records.filter((r) => !r.ok);
  const maps = measured.find((r) => r.maps)?.maps;

  const evidence = groups.slice(0, 8).map((g) => ({ id: g.id, where: `${g.scenario} ${g.step}`, in: `${g.in}/${g.of}`, ms: g.minMs === g.maxMs ? g.minMs : `${g.minMs}-${g.maxMs}`, cause: g.example }));
  for (const j of journeys) for (const b of j.blocks ?? []) if (!b.covered) evidence.push({ journey: `${b.ms} ms ${b.where}`, cause: b.verdict });
  const uncovered = journeys.flatMap((j) => j.blocks ?? []).filter((b) => !b.covered);

  const result = { groups, journeys: journeys.map((j) => ({ rep: j.rep, blocks: j.blocks, failure: j.failure })), failed: failed.map((r) => ({ scenario: r.scenario, step: r.step, rep: r.rep, failure: r.failure })), placement, ref: build.label, throttle, n, min, maps };
  const recurring = groups.filter((g) => g.in === g.of);
  let summary = groups.length
    ? `${groups.length} cause(s) of freezes of ${min} ms or more on ${build.label}${throttle > 1 ? ` at ${throttle}x CPU` : ''}; ${recurring.length} come back in every repetition. The worst: ${groups[0].example} (${groups[0].in}/${groups[0].of}).`
    : `no freeze of ${min} ms or more in ${measured.length} measured steps on ${build.label}${throttle > 1 ? ` at ${throttle}x CPU` : ''}.`;
  if (uncovered.length) summary += ` The journey found ${uncovered.length} long task(s) outside every step, where no scenario measures.`;
  if (failed.length) summary += ` ${failed.length} step(s) failed: see evidence.`;
  if (ctx.config.build && maps && maps.scripts && !maps.mapped) summary += ' No script had a source map: names are the built files\'. Turn source maps on in the build for source lines.';
  if (mode.label) summary += ` (${mode.label})`;
  run.finish({ status: 'ok', summary, ...result });
  if (failed.length) evidence.push({ failed: failed.slice(0, 3).map((r) => `${r.scenario} ${r.step} rep ${r.rep + 1}: ${r.failure.kind}, ${r.failure.reason}`) });
  const next = groups.length ? [`frameproof show ${groups[0].id}`, `frameproof query ${run.id} forced`, `frameproof price --inject 'css:<rules>' -s ${groups[0].scenario}`] : throttle === 1 ? [`frameproof freezes -s ${scenarios.map((s) => s.name).join(',')} --throttle 4`, `frameproof freezes -s journey,${scenarios.map((s) => s.name).join(',')}`] : [`frameproof ledger -s ${scenarios[0].name}`];
  return { status: 'ok', summary, run: run.id, evidence, next };
}
