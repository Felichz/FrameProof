// scenario: writing scenarios, the one creative task left, with a tight loop.
//
//   scenario list            the scenarios this project can run, built-in ones included
//   scenario new <name>      a file to start from, in the scenarios folder
//   scenario check <file>    runs it once and says what each step really did: an act that threw, a `done`
//                            that never came true, a step after which nothing changed on screen. A
//                            scenario that passes is recorded, with what it runs (for `affected`).
import { existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { UsageError } from '../cli/args.mjs';
import { allScenarios, pick } from '../scenarios.mjs';
import { blocks, coverageFile, ready } from '../session.mjs';
import { dirOf, ensure, readJson, writeJson } from '../store.mjs';
import { guard, openRun } from './_shared.mjs';

export const checksFile = (root) => join(dirOf(root), 'checks.json');

export default async function scenario(ctx) {
  const [sub, target] = ctx.args;
  if (sub === 'list') return list(ctx);
  if (sub === 'new') return create(ctx, target);
  if (sub === 'check') return check(ctx, target);
  throw new UsageError('scenario list | new <name> | check <file or name>', ['frameproof scenario list']);
}

async function list(ctx) {
  const { list: all, broken } = await allScenarios(ctx.config);
  const checks = readJson(checksFile(ctx.root), {});
  const evidence = all.map((s) => ({ name: s.name, file: s.file ? relative(ctx.root, s.file) : 'built in', steps: s.steps.map((x) => x.name).join(', '), checked: s.builtin ? undefined : checks[s.name]?.hash === s.hash ? 'yes' : 'no' }));
  for (const b of broken) evidence.push({ file: b.file, broken: b.error });
  return { status: 'ok', summary: `${all.length} scenarios (${all.filter((s) => !s.builtin).length} of the project's own), plus journey, which walks them in one trace${broken.length ? `; ${broken.length} file(s) don't load` : ''}`, evidence, next: ['frameproof scenario new <name>', 'frameproof guide scenarios'] };
}

const TEMPLATE = (name) => `// A scenario: what a person does on the page, in steps. Each step acts, then says with done() when it's
// done: a step that did nothing must fail, not pass as a fast one. Run it with: frameproof scenario check ${name}
// Guide: frameproof guide scenarios

/** @type {import('frameproof').Scenario} */
export default {
  name: '${name}',
  // Runs before each repetition, in a fresh page, unmeasured.
  setup: async ({ page, url }) => {
    await page.goto(url, { waitUntil: 'load' });
  },
  steps: [
    {
      name: 'open',
      act: ({ page }) => page.click('[data-open]'),
      // Resolves (or returns true) once the step happened; false or a reason string means not yet.
      done: ({ page }) => page.waitForSelector('dialog[open]'),
    },
    {
      name: 'close',
      act: ({ page }) => page.keyboard.press('Escape'),
      done: ({ page }) => page.waitForSelector('dialog:not([open])'),
    },
  ],
};
`;

function create(ctx, name) {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new UsageError('scenario new <name>, in lowercase words with dashes', ['frameproof scenario new open-cart']);
  const dir = ensure(resolve(ctx.root, ctx.config.scenarios));
  const file = join(dir, `${name}.js`);
  if (existsSync(file)) throw new UsageError(`${relative(ctx.root, file)} exists already: frameproof overwrites nothing`);
  writeFileSync(file, TEMPLATE(name));
  return { status: 'ok', summary: `wrote ${relative(ctx.root, file)}: change its setup and steps to what a person does, then check it`, evidence: [{ file: relative(ctx.root, file) }], next: [`frameproof scenario check ${name}`, 'frameproof guide scenarios'] };
}

async function check(ctx, target) {
  if (!target) throw new UsageError('scenario check <file or name>', ['frameproof scenario list']);
  const { scenarios, missing, broken } = await pick(ctx.config, [target]);
  if (!scenarios.length) {
    const b = broken.find((x) => target.endsWith(x.file) || x.file.includes(target));
    return { status: 'invalid', summary: b ? `${b.file} doesn't load as a scenario: ${b.error}` : `no scenario ${missing[0]}`, evidence: broken, next: ['frameproof scenario list', 'frameproof guide scenarios'] };
  }
  const s = scenarios[0];
  const stop = await guard(ctx, { frames: false });
  if (stop) return stop;
  const run = openRun(ctx, { command: 'scenario check', scenario: s.name });
  const build = ready(ctx.config, 'worktree', ctx.flags);
  const out = await blocks({ config: ctx.config, build, plan: [s], reps: 1, depth: 'work', run, tag: 'check', flags: ctx.flags, keep: 'none', coverage: true });
  const steps = out.records.filter((r) => !r.retry || true);
  const evidence = [];
  const problems = [];
  for (const st of s.steps) {
    const r = steps.filter((x) => x.step === st.name).at(-1);
    if (!r) {
      evidence.push({ step: st.name, did: 'never ran' });
      problems.push(st.name);
      continue;
    }
    if (!r.ok) {
      evidence.push({ step: st.name, failed: r.failure.kind, reason: r.failure.reason, hint: r.failure.hint, retried: r.retriedFailure ? 'failed again on a retry' : undefined });
      problems.push(st.name);
      continue;
    }
    const changed = r.counts.presented > 0 || (r.work?.totals?.paints ?? 0) > 0;
    const row = { step: st.name, ok: true, doneAfterMs: r.ms, frames: r.counts.frames, presented: r.counts.presented, late: r.counts.late };
    if (!changed && !s.builtin && st.name !== 'rest') {
      row.warning = 'nothing changed on screen during this step: no frame was presented and nothing painted. If the step should change the page, act() may not reach it, or done() passes too early';
      problems.push(st.name);
    }
    if (r.retried) row.note = `passed on a retry after: ${r.retried.kind}, ${r.retried.reason}`;
    evidence.push(row);
  }
  const files = out.coverage?.[s.name] ?? [];
  if (files.length) {
    const file = coverageFile(ctx.config);
    const cov = readJson(file, {});
    cov[s.name] = { files, date: new Date().toISOString() };
    writeJson(file, cov);
  }
  const ok = !problems.length;
  if (ok && s.file) {
    const checks = readJson(checksFile(ctx.root), {});
    checks[s.name] = { hash: s.hash, date: new Date().toISOString() };
    writeJson(checksFile(ctx.root), checks);
  }
  const summary = ok ? `${s.name}: every step did what it says (${s.steps.length} steps); it runs ${files.length} source file(s)` : `${s.name}: ${problems.length} step(s) to fix: ${problems.join(', ')}`;
  run.finish({ status: ok ? 'ok' : 'invalid', summary, steps: evidence, runs: files.slice(0, 40) });
  return { status: ok ? 'ok' : 'invalid', summary, run: run.id, evidence, next: ok ? ['frameproof next'] : ['fix the step, then run this again', 'frameproof guide scenarios'] };
}
