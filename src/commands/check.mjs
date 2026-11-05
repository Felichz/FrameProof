// check: budgets over counted work, for CI. Each rule reads one scenario's step and says the most it may
// cost; the count is taken from every repetition and the least is kept, so a rule fails on work every run
// did, not on a slow one. Exit 1 when a rule breaks. Runs headless where there is no display: counts hold
// there, frames don't, and it says so.
//
//   // perf/budgets.js
//   export default [
//     { scenario: 'idle', step: 'rest', says: 'at rest, nothing asks for frames', count: (r) => r.rafs, max: 0 },
//     { scenario: 'scroll', says: 'scrolling forces no layout', count: (r) => r.forced('layout'), max: 0 },
//     { scenario: 'idle', says: 'only the clock asks for timers', count: (r) => r.timers - r.asked('timer', /clock\.js/), max: 0 },
//   ];
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { number, string, UsageError } from '../cli/args.mjs';
import { display } from '../machine.mjs';
import { guard, openRun, scenariosFor } from './_shared.mjs';
import { workRun } from './ledger.mjs';

const helpers = (w) => {
  const sum = (o, kind, re) => Object.entries(o ?? {}).filter(([k]) => (!kind || k.startsWith(`${kind} `)) && (!re || re.test(k.slice(k.indexOf(' ') + 1)))).reduce((s, [, n]) => s + n, 0);
  return { ...w.totals, asked: (kind, re) => sum(w.askers, kind, re), forced: (kind, re) => sum(w.forced, kind, re), threads: w.threads };
};

export default async function check(ctx) {
  const f = ctx.flags;
  const file = resolve(ctx.root, string(f, 'budgets', ctx.config.budgets));
  if (!existsSync(file)) throw new UsageError(`no budgets at ${file}. Write rules over counted work there (see the guide), from what a ledger run shows`, ['frameproof guide budgets', 'frameproof ledger -s idle']);
  const rules = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)).default;
  if (!Array.isArray(rules) || !rules.length) throw new UsageError(`${file} exports no rules: \`export default [{ scenario, says, count: (r) => r.rafs, max: 0 }]\``);
  if (!display().ok) f.headless = true;
  const stop = await guard(ctx, { frames: false });
  if (stop) return stop;
  ctx.flags.scenario = [...new Set(rules.map((r) => r.scenario))];
  const scenarios = await scenariosFor(ctx);
  const run = openRun(ctx, { command: 'check', budgets: file, scenarios: scenarios.map((s) => s.name) });
  const { build, steps, mode } = await workRun(ctx, { run, scenarios, ref: string(f, 'ref', 'worktree'), n: number(f, 'n', 3) });

  const results = rules.map((rule) => {
    const targets = steps.filter((e) => e.scenario === rule.scenario && (!rule.step || e.step === rule.step));
    if (!targets.length || targets.every((e) => !e.runs.length)) return { rule: rule.says, scenario: rule.scenario, ok: false, broken: 'no repetition of this step succeeded', failures: targets.flatMap((e) => e.failed).slice(0, 2) };
    const counts = targets.flatMap((e) => e.runs.map((w) => {
      try {
        return Number(rule.count(helpers(w)));
      } catch (err) {
        return NaN;
      }
    }));
    if (counts.some((c) => Number.isNaN(c))) return { rule: rule.says, scenario: rule.scenario, ok: false, broken: 'count() threw or gave no number' };
    const least = Math.min(...counts);
    return { rule: rule.says, scenario: `${rule.scenario}${rule.step ? '/' + rule.step : ''}`, ok: least <= rule.max, count: least, max: rule.max };
  });
  const broken = results.filter((r) => !r.ok);
  const summary = broken.length ? `${broken.length} of ${results.length} budgets broken on ${build.label}: ${broken.map((b) => `"${b.rule}" (${b.count ?? b.broken}${b.max !== undefined ? ` > ${b.max}` : ''})`).join('; ')}` : `all ${results.length} budgets hold on ${build.label}`;
  run.finish({ status: broken.length ? 'failed' : 'ok', summary, results });
  return { status: broken.length ? 'failed' : 'ok', summary: summary + [mode.label, ctx.loadNote].filter(Boolean).map((x) => ` (${x})`).join(''), run: run.id, evidence: [...broken, ...results.filter((r) => r.ok)], next: broken.length ? [`frameproof query ${run.id} forced`, `frameproof query ${run.id} askers`, `frameproof freezes -s ${broken[0].scenario.split('/')[0]}`] : [] };
}
