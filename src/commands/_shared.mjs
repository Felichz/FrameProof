// Helpers the commands share: the run they write to, the scenarios they were asked for, the machine guard,
// calibrations and the journal.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { list, number, UsageError } from '../cli/args.mjs';
import { busy, chromePath, display } from '../machine.mjs';
import { pick } from '../scenarios.mjs';
import { dirOf, ensure, readJson, Run, writeJson } from '../store.mjs';

export function openRun(ctx, meta) {
  const id = ctx.flags['run-id'];
  // A background run's folder exists already, with the pid `wait` watches.
  const before = id ? Run.open(ctx.root, id)?.meta ?? {} : {};
  return Run.create(ctx.root, { ...before, command: meta.command, argv: process.argv.slice(2), machine: ctx.machine, ...meta, state: 'running' }, id);
}

export async function scenariosFor(ctx, { fallback = [], min = 1 } = {}) {
  const wanted = list(ctx.flags, 'scenario', fallback);
  if (wanted.length < min) throw new UsageError('which scenario? pass -s <name> (built in: load, idle, scroll, journey)', ['frameproof scenario list']);
  const { scenarios, missing, available, broken } = await pick(ctx.config, wanted);
  if (missing.length) throw new UsageError(`no scenario named ${missing.join(', ')}. Available: ${available.join(', ')}${broken.length ? `. Broken files: ${broken.map((b) => `${b.file} (${b.error})`).join('; ')}` : ''}`, ['frameproof scenario list']);
  return scenarios;
}

export const throttles = (flags, fallback = [1]) => list(flags, 'throttle', fallback.map(String)).map(Number);

/**
 * Whether this machine can measure frames right now. Returns null when it can, or the envelope that says
 * why not: not-measurable, with what is using the machine. Nothing is killed: the person is told.
 */
export async function guard(ctx, { frames = true } = {}) {
  if (!chromePath()) return { status: 'not-measurable', summary: 'Chrome is not installed where frameproof looks, and CHROME_PATH is not set', next: ['npx @puppeteer/browsers install chrome@stable', 'then set CHROME_PATH to the path it prints'] };
  const d = display();
  if (frames && !d.ok && !ctx.flags.headless) return { status: 'not-measurable', summary: `frames can't be judged here: ${d.why}. Counted work still can, headless.`, next: ['frameproof ledger -s <scenario> --headless', 'frameproof check --headless'] };
  if (ctx.flags['ignore-load']) return null;
  const b = await busy();
  if (b.busy && !frames) {
    // Counted work moves little with the load (it is what holds budgets on noisy CI runners): it runs, and
    // says it ran on a busy machine.
    ctx.loadNote = `counted on a busy machine (${Math.round(b.share * 100)}% CPU): counts hold, times run high`;
    return null;
  }
  if (b.busy) {
    const who = b.top?.length ? `; using it: ${b.top.map((p) => `${p.name} ${Math.round(p.cpu)}%`).join(', ')}` : '';
    return { status: 'not-measurable', summary: `the machine is busy (${Math.round(b.share * 100)}% of the CPU in use${who}). Numbers now would be about that load. Wait for it to end; don't stop processes you didn't start.`, evidence: [{ cpu: `${Math.round(b.share * 100)}%`, top: b.top }], next: ['frameproof doctor', 'run the same command again once the machine is free'] };
  }
  return null;
}

// ---- Calibration: per machine, per cell ------------------------------------------------------------------

const calFile = (ctx) => join(ensure(join(dirOf(ctx.root), 'calibration')), `${ctx.machine.id}.json`);
export const readCalibration = (ctx) => readJson(calFile(ctx), { cells: {} });
export function writeCalibration(ctx, cal) {
  writeJson(calFile(ctx), cal);
}
export const cellId = (scenario, step, throttle) => `${scenario}/${step}@${throttle}x`;

/** The margin for one cell: the flag, then the scenario's own, then calibration, then the default. */
export function marginFor(ctx, scenario, step, throttle) {
  const flag = number(ctx.flags, 'margin', null);
  if (flag !== null) return { margin: flag, from: '--margin' };
  if (typeof scenario.margin === 'number') return { margin: scenario.margin, from: 'the scenario' };
  if (scenario.margin?.[step] !== undefined) return { margin: scenario.margin[step], from: 'the scenario' };
  const cal = readCalibration(ctx).cells[cellId(scenario.name, step, throttle)];
  if (cal) return { margin: cal.margin, from: `calibrate, ${cal.date.slice(0, 10)}` };
  return { margin: ctx.config.margin, from: 'the default (not calibrated on this machine)' };
}

// ---- Journal ------------------------------------------------------------------------------------------------

export const journalFile = (ctx) => resolve(ctx.root, ctx.config.journal);

const JOURNAL_HEAD = `# Performance journal

What was tried, and what came of it, newest last. \`frameproof compare\` and \`frameproof price\` add to it;
edit it freely. Read it before starting: a dead end tried once doesn't need trying again without a new reason.
`;

export function appendJournal(ctx, { kind, run, hypothesis, change, status, summary, cells = [] }) {
  const file = journalFile(ctx);
  ensure(dirname(file));
  if (!existsSync(file)) writeFileSync(file, JOURNAL_HEAD);
  // Local time: the person reads the journal in their own day.
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const lines = [
    '',
    `## ${date} · ${kind} · ${status}`,
    '',
    `- **Hypothesis:** ${hypothesis || '(none given: pass --note next time)'}`,
    `- **Change:** ${change}`,
    `- **Result:** ${summary}`,
    ...cells.slice(0, 8).map((c) => `  - ${c.id}: ${c.verdict}${c.effect ? `, ${signed(c.effect.lateFrames)} late frames a step [${c.effect.interval.join(', ')}]` : ''}${c.reason ? ` (${c.reason})` : ''}`),
    `- **Run:** ${run} on ${ctx.machine.id}`,
  ];
  appendFileSync(file, lines.join('\n') + '\n');
  return relative(ctx.root, file);
}

export const signed = (v) => (typeof v === 'number' && v > 0 ? `+${v}` : String(v));

export function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
