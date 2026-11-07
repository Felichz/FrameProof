// bisect (ADR 0002): which part of a page holds a scenario's frames, or which commit made it worse.
//
//   frameproof bisect -s scroll --candidates 'hide:.ambient' 'hide:video' 'hide:iframe'
//   frameproof bisect -s scroll --refine '.ambient'
//   frameproof bisect -s scroll --base <good> --head <bad>
//
// Each step is a price (the same build with and without the candidates taken away, alternated) or, with
// --screen work, a count of the work. Steps land in the run as they finish; --resume <run> takes them up.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { number, string, UsageError } from '../cli/args.mjs';
import { bisect, bisectCommits, combine, expand, FINER } from '../core/bisect.mjs';
import { blocks, ready } from '../session.mjs';
import { power } from '../machine.mjs';
import { Run } from '../store.mjs';
import { abSession } from './ab.mjs';
import { appendJournal, guard, modeNote, openRun, scenariosFor, throttles } from './_shared.mjs';

export default async function bisectCommand(ctx) {
  const f = ctx.flags;
  const scenarios = await scenariosFor(ctx);
  if (scenarios.length !== 1 || scenarios[0].journey) throw new UsageError('bisect takes one scenario (-s <name>): its steps are what each split is judged on', ['frameproof bisect -s scroll --candidates hide:.a hide:.b']);
  const ths = throttles(f, [1]);
  const screenMin = number(f, 'minutes', 8);
  const confirmMin = number(f, 'confirm-minutes', 15);
  const maxSteps = number(f, 'max-steps', 12);
  const check = async () => guard(ctx, { frames: string(f, 'screen', 'frames') === 'frames' || !!(f.base || f.head) });
  if (f.base || f.head) {
    const stop = await check();
    return stop ?? commits(ctx, { scenarios, ths, screenMin, maxSteps });
  }

  const refine = string(f, 'refine', null);
  // Candidates as arguments, or --candidates repeated: never split on commas, which selectors use.
  const given = [...ctx.args, ...[].concat(f.candidates ?? []).filter((x) => typeof x === 'string')];
  const raw = refine ? FINER.map((k) => `${k}:${refine}`) : given;
  if (!raw.length) throw new UsageError('bisect needs --candidates (or --refine <selector>, or --base and --head)', ["frameproof bisect -s scroll 'hide:.ambient' 'hide:video'", "frameproof bisect -s scroll --refine '.ambient'"]);
  let candidates;
  try {
    candidates = raw.map((c) => expand(c, (file) => readFileSync(resolve(ctx.root, file), 'utf8')));
  } catch (e) {
    throw new UsageError(e.message, ['frameproof guide bisect']);
  }
  // (A usage mistake is said before the machine is checked: it costs nothing.)
  const stop = await check();
  if (stop) return stop;
  const screen = string(f, 'screen', 'frames');
  // A split that was cut short (the browser lost, the run stopped) isn't a result: it's measured again.
  const resumed = Object.fromEntries(Object.entries(f.resume ? Run.open(ctx.root, string(f, 'resume', null))?.meta?.bisect?.cache ?? {} : {}).filter(([, r]) => r && r.status !== 'partial' && !r.lost));
  const run = openRun(ctx, { command: 'bisect', scenarios: scenarios.map((s) => s.name), throttles: ths, candidates: raw, screen, refine: refine ?? undefined, note: string(f, 'note', null) });
  const build = ready(ctx.config, string(f, 'ref', 'worktree'), f);
  const cache = { ...resumed };
  let n = 0;
  const records = [];

  // Takes `set` away, and says whether the scenario got better (and nothing worse).
  const byFrames = async (set, minutes) => {
    const inject = combine(set, run.dir, `step-${++n}`);
    const out = await abSession(ctx, { run, base: build, head: build, injectB: inject, scenarios, throttles: ths, reps: number(f, 'batch', 4), minutes, looks: number(f, 'looks', 6) });
    records.push(...(out.records ?? []));
    const better = out.results.some((c) => c.verdict === 'better') && !out.results.some((c) => c.verdict === 'worse');
    return { better, status: out.status, cells: out.results.map((c) => ({ id: c.id, verdict: c.verdict, typical: c.typical, effect: c.effect?.lateFrames, interval: c.effect?.interval })), lost: out.lost ?? undefined };
  };
  // The scenario's counted work with and without: main-thread time and the GPU's, the least of two each.
  const byWork = async (set) => {
    const inject = combine(set, run.dir, `step-${++n}`);
    const cost = async (inj) => {
      const out = await blocks({ config: ctx.config, build, plan: scenarios, reps: 2, throttle: ths[0], depth: 'work', inject: inj, run, tag: inj ? 'head' : 'base', block: n, flags: f, keep: 'none' });
      const by = new Map();
      for (const r of out.records) if (r.ok && r.work) by.set(`${r.step}|${r.rep}`, (r.work.totals.busyMs ?? 0) + (r.work.threads?.gpu ?? 0));
      const reps = {};
      for (const [k, ms] of by) {
        const rep = k.split('|')[1];
        reps[rep] = (reps[rep] ?? 0) + ms;
      }
      return Math.min(...Object.values(reps));
    };
    const [a, b] = [await cost(null), await cost(inject)];
    return { better: b <= a * 0.85, work: { base: Math.round(a), head: Math.round(b) } };
  };
  const judge = async (set, key) => {
    const r = screen === 'work' ? await byWork(set) : await byFrames(set, screenMin);
    if (r.status !== 'partial' && !r.lost) {
      cache[key] = r;
      run.save({ bisect: { cache } });
    }
    return r;
  };

  const found = await bisect(candidates, judge, { maxSteps, known: resumed });
  // Each culprit confirmed in frames, on a longer run; not on battery, where frames would be about the
  // battery (a bisection screened by work can run there): the confirmation is left as a command.
  const confirmed = [];
  const onBattery = power().battery && !f.battery;
  if (!onBattery) for (const c of found.culprits) confirmed.push({ candidate: c.label, ...(await byFrames([c], confirmMin)) });

  const serving = modeNote(records);
  const named = confirmed.filter((c) => c.better).map((c) => c.candidate);
  let summary;
  if (!found.explained) summary = `taking all ${raw.length} candidates away together didn't make ${scenarios[0].name} better: the cost isn't among them`;
  else if (onBattery && found.culprits.length) summary = `${found.culprits.map((c) => c.label).join(' and ')} kept the gain on screening; not confirmed in frames, since the machine runs on its battery: plug it in and run frameproof price --inject '<the culprit>' -s ${scenarios[0].name}`;
  else if (named.length) summary = `${named.join(' and ')} ${named.length > 1 ? 'hold' : 'holds'} ${scenarios[0].name}'s frames: confirmed on a ${confirmMin}-minute run${found.together.length ? `; also only together: ${found.together.join('; ')}` : ''}`;
  else if (found.together.length) summary = `the cost shows only with these away together, not with any part of them: ${found.together.join('; ')}. Two causes that cover for each other, or one spread across them`;
  else summary = `the split candidates looked better on screening, but none held on confirmation: ${found.culprits.map((c) => c.label).join(', ') || 'none'}`;
  summary += ` (${found.steps.length} split(s) priced${Object.keys(resumed).length ? `, ${Object.keys(resumed).length} taken from the resumed run` : ''}, screened by ${screen}).`;
  if (serving) summary += ` ${serving}.`;
  const result = { status: 'ok', summary, culprits: named, together: found.together, steps: found.steps, confirmed };
  run.finish(result);
  appendJournal(ctx, { kind: 'bisect', run: run.id, hypothesis: string(f, 'note', ''), change: `take away ${raw.join(', ')} on ${build.label}`, status: named.length ? 'found' : 'not found', summary, cells: confirmed.flatMap((c) => c.cells.map((x) => ({ id: `${c.candidate} ${x.id}`, verdict: x.verdict }))) });
  const next = named.length
    ? named.some((c) => c.startsWith('hide:'))
      ? [`frameproof bisect -s ${scenarios[0].name} --refine '${named.find((c) => c.startsWith('hide:')).slice(5)}'`, 'change the culprit, then: frameproof compare --base HEAD --head worktree -s ' + scenarios[0].name]
      : ['change the culprit, then: frameproof compare --base HEAD --head worktree -s ' + scenarios[0].name]
    : [`frameproof freezes -s ${scenarios[0].name}`, `frameproof bisect -s ${scenarios[0].name} --resume ${run.id} --max-steps 20`];
  return { status: 'ok', summary, run: run.id, evidence: [...found.steps.map((s) => ({ split: s.set, better: s.better, cells: s.cells?.map((c) => `${c.id} ${c.verdict} ${c.typical ? `${c.typical.base}→${c.typical.head}` : ''}`.trim()), work: s.work })), ...confirmed.map((c) => ({ confirm: c.candidate, better: c.better, cells: c.cells.map((x) => `${x.id} ${x.verdict}`) }))], next };
}

/** The first commit between --base (good) and --head (bad) that makes the scenario worse. */
async function commits(ctx, { scenarios, ths, screenMin, maxSteps }) {
  const f = ctx.flags;
  const good = string(f, 'base', null);
  const bad = string(f, 'head', null);
  if (!good || !bad) throw new UsageError('a commit bisection needs --base <good> and --head <bad>', ['frameproof bisect -s scroll --base v1.2 --head main']);
  const list = execFileSync('git', ['rev-list', '--reverse', `${good}..${bad}`], { cwd: ctx.root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  if (!list.length) throw new UsageError(`no commit between ${good} and ${bad}`);
  const run = openRun(ctx, { command: 'bisect', scenarios: scenarios.map((s) => s.name), throttles: ths, base: good, head: bad, note: string(f, 'note', null) });
  const base = ready(ctx.config, good, f);
  const found = await bisectCommits(list, async (sha) => {
    const out = await abSession(ctx, { run, base, head: ready(ctx.config, sha, f), scenarios, throttles: ths, reps: number(f, 'batch', 4), minutes: screenMin, looks: number(f, 'looks', 6) });
    const r = { bad: out.results.some((c) => c.verdict === 'worse'), cells: out.results.map((c) => `${c.id} ${c.verdict}`) };
    run.save({ bisect: { commits: list, last: { sha, ...r } } });
    return r;
  }, { maxSteps });
  const subject = found.first ? execFileSync('git', ['log', '-1', '--format=%h %s', found.first], { cwd: ctx.root, encoding: 'utf8' }).trim() : null;
  const summary = subject ? `${subject} is the first commit after ${good} that makes ${scenarios[0].name} worse (${found.steps.length} commits compared)` : `no commit between ${good} and ${bad} was found worse within ${maxSteps} steps`;
  run.finish({ status: 'ok', summary, first: found.first, steps: found.steps });
  appendJournal(ctx, { kind: 'bisect', run: run.id, hypothesis: string(f, 'note', ''), change: `commits ${good}..${bad}`, status: found.first ? 'found' : 'not found', summary });
  return { status: 'ok', summary, run: run.id, evidence: found.steps, next: found.first ? [`git show ${found.first}`, `frameproof compare --base ${found.first}~1 --head ${found.first} -s ${scenarios[0].name}`] : [] };
}
