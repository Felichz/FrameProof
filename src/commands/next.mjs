// next: the one thing to do now, with its exact command, from the state of the project and the machine.
// A state machine rather than a page of instructions: it can't be skimmed or misread, and it always matches
// the installed version.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirtyFiles, isGit } from '../builds.mjs';
import { busy, chromePath, display } from '../machine.mjs';
import { allScenarios } from '../scenarios.mjs';
import { listRuns, readJson } from '../store.mjs';
import { readCalibration } from './_shared.mjs';
import { affectedScenarios } from './affected.mjs';
import { GOALS_MARK } from './init.mjs';
import { checksFile } from './scenario.mjs';

export function readGoals(ctx) {
  const file = resolve(ctx.root, ctx.config.goals);
  if (!existsSync(file)) return { exists: false };
  const text = readFileSync(file, 'utf8');
  const unanswered = text.includes(GOALS_MARK);
  const questions = [...text.matchAll(/^## (.+\?)\s*$/gm)].map((m) => m[1]);
  // The scenarios named in backticks in the first section, in order.
  const first = text.split(/^## /m)[1] ?? '';
  const named = [...first.matchAll(/`([a-z0-9][a-z0-9-]*)`/g)].map((m) => m[1]);
  const throttle = Number(/Throttle:\s*(\d+(?:\.\d+)?)x/i.exec(text)?.[1] ?? 4);
  return { exists: true, file, unanswered, questions, named: [...new Set(named)], throttle };
}

export default async function next(ctx) {
  const say = (summary, command, evidence = [], extra = []) => ({ status: 'ok', summary, evidence, next: [command, ...extra].filter(Boolean) });

  if (!chromePath()) return { status: 'not-measurable', summary: 'Chrome is not installed where frameproof looks. Install it, or download a pinned build and point CHROME_PATH at it', next: ['npx @puppeteer/browsers install chrome@stable', 'export CHROME_PATH=<the path it printed>'] };
  if (!ctx.config.file) return say('this project has no frameproof config yet: add it, with the goals, journal and scenarios folder (nothing is overwritten)', 'frameproof init');

  const goals = readGoals(ctx);
  if (!goals.exists) return say(`${ctx.config.goals} is missing: init writes it`, 'frameproof init');
  if (goals.unanswered) {
    return {
      status: 'ok',
      summary: `ask the person these questions and write the answers in ${ctx.config.goals}, then delete its "unanswered" line. It's the one thing the tool can't work out`,
      evidence: [{ ask: goals.questions }],
      next: [`edit ${ctx.config.goals}`, 'frameproof next'],
    };
  }

  const { list, own, broken } = await allScenarios(ctx.config);
  if (broken.length) return say(`${broken[0].file} doesn't load as a scenario: ${broken[0].error}`, `frameproof scenario check ${broken[0].file}`, broken.slice(0, 3));
  const known = new Set(list.map((s) => s.name));
  const missing = goals.named.filter((n) => !known.has(n) && n !== 'journey');
  if (missing.length) return say(`the goals name ${missing.map((m) => `\`${m}\``).join(', ')}, which no scenario measures yet: write it, from the template`, `frameproof scenario new ${missing[0]}`, [], ['frameproof guide scenarios', 'frameproof scenario list']);
  const goalScenarios = goals.named.length ? goals.named : ['load', 'scroll'];
  if (!own.length && !goals.named.length) return say('no scenario of the project\'s own, and the goals name none: write one for the interaction that matters most. Meanwhile load, idle and scroll are built in', 'frameproof scenario new <name>', [], ['frameproof guide scenarios']);

  const checks = readJson(checksFile(ctx.root), {});
  const unchecked = own.filter((s) => checks[s.name]?.hash !== s.hash);
  if (unchecked.length) return say(`${unchecked[0].name} hasn't been checked since it last changed: run it once and see what each step really does`, `frameproof scenario check ${unchecked[0].name}`, [{ unchecked: unchecked.map((s) => s.name) }]);

  const d = display();
  if (!d.ok) return say(`frames can't be judged here (${d.why}). Counted work can: hold budgets headless`, 'frameproof check --headless', [], ['frameproof ledger -s idle --headless']);

  const load = await busy();
  if (load.busy) return { status: 'not-measurable', summary: `the machine is busy (${Math.round(load.share * 100)}% CPU${load.top?.length ? `, using it: ${load.top.map((p) => p.name).join(', ')}` : ''}). Wait for it to end; don't stop processes you didn't start`, evidence: [{ top: load.top }], next: ['frameproof next'] };

  const throttles = goals.throttle > 1 ? `1,${goals.throttle}` : '1';
  const cal = readCalibration(ctx);
  const uncal = goalScenarios.filter((s) => !Object.keys(cal.cells).some((c) => c.startsWith(`${s}/`)));
  if (uncal.length) return say(`this machine isn't calibrated for ${uncal.join(', ')}: find its noise floor and what it can see, once (about 15 minutes; --background to keep working)`, `frameproof calibrate -s ${uncal.join(',')} --throttle ${throttles} --background`);

  if (isGit(ctx.root) && dirtyFiles(ctx.root).length) {
    const a = await affectedScenarios(ctx, 'HEAD', 'worktree');
    const s = a.scenarios.length ? a.scenarios : goalScenarios;
    return say(`there are uncommitted changes${a.scenarios.length ? `; they touch files that ${a.scenarios.join(', ')} run` : ''}: judge them against the last commit`, `frameproof compare --base HEAD --head worktree -s ${s.join(',')} --throttle ${throttles} --note "<your hypothesis>"`, [{ changed: dirtyFiles(ctx.root).slice(0, 6), orphan: a.orphan.slice(0, 4) }]);
  }

  const runs = listRuns(ctx.root);
  const lastFreezes = runs.find((r) => r.command === 'freezes' && r.state === 'done');
  if (!lastFreezes) return say(`ready, and nothing found yet: look for freezes in the scenarios that matter (${goalScenarios.join(', ')}), at the modest machine's throttle, with a journey for what no scenario covers`, `frameproof freezes -s ${['journey', ...goalScenarios].join(',')} --throttle ${goals.throttle}`, [], ['frameproof journal']);
  const groups = lastFreezes.result?.groups ?? [];
  if (groups.length) return say(`the last freezes run found ${groups.length} cause(s); the worst comes back in ${groups[0].in}/${groups[0].of} repetitions: ${groups[0].example}. Read its dossier, price a fix if you can, change one thing, then compare`, `frameproof show ${lastFreezes.id}/f1`, [], [`frameproof query ${lastFreezes.id} forced`, 'frameproof journal']);
  return say('no freeze found in the last run: hold what is good with budgets, or look harder (more repetitions, a higher throttle, cold profiles)', 'frameproof check', [], [`frameproof freezes -s ${goalScenarios.join(',')} --throttle ${Math.max(4, goals.throttle)} -n 8 --cold`]);
}
