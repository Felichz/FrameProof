// freezes: what exactly froze, and why. Each run of late frames long enough gets a dossier (the stage that
// held it, the main thread broken down to source lines, V8's samples, other threads, surfaces, the GPU) and
// a verdict; the freezes are grouped by cause across repetitions, what comes back every time first.
import { number, string } from '../cli/args.mjs';
import { groupFreezes } from '../core/freezes.mjs';
import { blocks, ready } from '../session.mjs';
import { guard, modeNote, openRun, scenariosFor, throttles } from './_shared.mjs';

export default async function freezes(ctx) {
  const f = ctx.flags;
  const stop = await guard(ctx);
  if (stop) return stop;
  const scenarios = await scenariosFor(ctx);
  const ref = string(f, 'ref', 'worktree');
  const [throttle] = throttles(f, [1]);
  const n = number(f, 'n', 4);
  // Freezes from 50 ms: a 67 ms freeze is four frames a visitor sees. Episodes in compare start at the
  // config's episodeMs (100); the light check below counts at this run's line, and the summary says when the
  // two differ (ADR 0001 D5).
  const line = ctx.config.episodeMs ?? 100;
  const min = number(f, 'min', 50);
  const lightN = number(f, 'light-n', n * 2);
  const run = openRun(ctx, { command: 'freezes', ref, scenarios: scenarios.map((s) => s.name), throttle, n, min });
  const build = ready(ctx.config, ref, f);
  const { records, placement, mode } = await blocks({ config: ctx.config, build, plan: scenarios, reps: n, throttle, depth: 'full', run, tag: 'ref', flags: f, keep: f.keep ? 'all' : 'freezes' });

  const measured = records.filter((r) => r.ok && r.scenario !== 'journey');
  const steps = measured.map((r) => ({ scenario: r.scenario, step: r.step, rep: r.rep, trace: r.trace, freezes: (r.freezes ?? []).filter((x) => x.ms >= min) }));
  const found = groupFreezes(steps);

  // Deep tracing slows the page it watches: a freeze it finds may not be there without it. The same
  // scenarios run with light tracing, and each group says how many of those repetitions had an episode at
  // the same line (ADR 0001 D6).
  const light = new Map();
  const withFreezes = scenarios.filter((s) => !s.journey && found.some((g) => g.scenario === s.name));
  if (lightN > 0 && withFreezes.length) {
    const reps = Math.max(1, Math.round(lightN / 2));
    for (let k = 0; k < 2; k++) {
      const out = await blocks({ config: ctx.config, build, plan: withFreezes, reps, throttle, depth: 'light', run, tag: 'light', block: 100 + k, flags: f, keep: 'none' });
      for (const r of out.records) {
        if (!r.ok) continue;
        const key = `${r.scenario} ${r.step}`;
        const e = light.get(key) ?? { episodes: 0, of: 0 };
        e.of++;
        if ((r.counts?.longestFreezeMs ?? 0) >= min) e.episodes++;
        light.set(key, e);
      }
    }
  }
  // Which repetitions began on a page still busy from its setup (ADR 0001 D9).
  const busyAtStart = new Map();
  for (const r of measured) if (r.notQuiet) busyAtStart.set(`${r.scenario} ${r.step}`, (busyAtStart.get(`${r.scenario} ${r.step}`) ?? 0) + 1);
  const groups = found
    .map((g) => {
      const l = light.get(`${g.scenario} ${g.step}`);
      const b = busyAtStart.get(`${g.scenario} ${g.step}`);
      return { ...g, light: l ? `${l.episodes}/${l.of} at ${min} ms` : undefined, deepOnly: l ? l.episodes === 0 : undefined, busyAtStart: b ? `${b}/${g.of}` : undefined };
    })
    .sort((x, y) => Number(!!x.deepOnly) - Number(!!y.deepOnly))
    .map((g, i) => ({ ...g, id: `f${i + 1}` }));
  const journeys = records.filter((r) => r.scenario === 'journey');
  const failed = records.filter((r) => !r.ok);
  const maps = measured.find((r) => r.maps)?.maps;

  const evidence = groups.slice(0, 8).map((g) => ({ id: g.id, where: `${g.scenario} ${g.step}`, in: `${g.in}/${g.of}`, light: g.light, ...(g.deepOnly ? { seen: 'deep tracing only' } : {}), ...(g.busyAtStart ? { busyAtStart: g.busyAtStart } : {}), ms: g.minMs === g.maxMs ? g.minMs : `${g.minMs}-${g.maxMs}`, cause: g.example }));
  for (const j of journeys) for (const b of j.blocks ?? []) if (!b.covered) evidence.push({ journey: `${b.ms} ms ${b.where}`, cause: b.verdict });
  const uncovered = journeys.flatMap((j) => j.blocks ?? []).filter((b) => !b.covered);

  const serving = modeNote(measured);
  const result = { mode: serving || undefined, groups, journeys: journeys.map((j) => ({ rep: j.rep, blocks: j.blocks, failure: j.failure })), failed: failed.map((r) => ({ scenario: r.scenario, step: r.step, rep: r.rep, failure: r.failure })), placement, ref: build.label, throttle, n, min, maps };
  const confirmed = groups.filter((g) => !g.deepOnly);
  const recurring = confirmed.filter((g) => g.in === g.of);
  const deepOnly = groups.length - confirmed.length;
  let summary = confirmed.length
    ? `${confirmed.length} cause(s) of freezes of ${min} ms or more on ${build.label}${throttle > 1 ? ` at ${throttle}x CPU` : ''}; ${recurring.length} come back in every repetition. The worst: ${confirmed[0].example} (${confirmed[0].in}/${confirmed[0].of}${confirmed[0].light ? `, light runs ${confirmed[0].light}` : ''}).`
    : `no freeze of ${min} ms or more${groups.length ? ' that light runs confirm' : ''} in ${measured.length} measured steps on ${build.label}${throttle > 1 ? ` at ${throttle}x CPU` : ''}.`;
  if (deepOnly) summary += ` ${deepOnly} more seen under deep tracing only: no light repetition had them, so a visitor likely doesn't either.`;
  if (min < line && confirmed.some((g) => g.maxMs < line)) summary += ` (Freezes from ${min} ms count here; compare counts a repetition as an episode from ${line} ms, so the shorter ones show in its typical late frames, not its episodes.)`;
  if (serving) summary += ` ${serving}.`;
  if (uncovered.length) summary += ` The journey found ${uncovered.length} long task(s) outside every step, where no scenario measures.`;
  if (failed.length) summary += ` ${failed.length} step(s) failed: see evidence.`;
  if (ctx.config.build && maps && maps.scripts && !maps.mapped) summary += ' No script had a source map: names are the built files\'. Turn source maps on in the build for source lines.';
  for (const note of [mode.label, ctx.loadNote].filter(Boolean)) summary += ` (${note})`;
  run.finish({ status: 'ok', summary, ...result });
  if (failed.length) evidence.push({ failed: failed.slice(0, 3).map((r) => `${r.scenario} ${r.step} rep ${r.rep + 1}: ${r.failure.kind}, ${r.failure.reason}`) });
  const next = groups.length ? [`frameproof show ${groups[0].id}`, `frameproof query ${run.id} forced`, `frameproof price --inject 'css:<rules>' -s ${groups[0].scenario}`] : throttle === 1 ? [`frameproof freezes -s ${scenarios.map((s) => s.name).join(',')} --throttle 4`, `frameproof freezes -s journey,${scenarios.map((s) => s.name).join(',')}`] : [`frameproof ledger -s ${scenarios[0].name}`];
  return { status: 'ok', summary, run: run.id, evidence, next };
}
