// Helpers the commands share: the run they write to, the scenarios they were asked for, the machine guard,
// calibrations and the journal.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { list, number, UsageError } from '../cli/args.mjs';
import { busy, chromePath, display, power } from '../machine.mjs';
import { displayProbe } from '../probe.mjs';
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
  // On battery a laptop slows its CPU and GPU, and by more as the charge falls: frames then are about the
  // battery. Counted work still runs; frames need --battery to be measured anyway.
  const p = power();
  if (p.battery && frames && !ctx.flags.battery) return { status: 'not-measurable', summary: `the machine runs on its battery (${p.why}): it slows the CPU and GPU, by more as the charge falls, so frames now would be about the battery. Plug it in, or pass --battery to measure anyway (both builds of a compare are slowed alike; numbers from other runs won't compare).`, next: ['plug the machine in, then run the same command again', 'the same command with --battery'] };
  if (p.battery) ctx.loadNote = [ctx.loadNote, `on battery (${p.why})`].filter(Boolean).join('; ');
  const b = await busy();
  if (ctx.flags['ignore-load']) {
    if (b.busy) ctx.loadNote = `measured on a busy machine (${Math.round(b.share * 100)}% CPU), with --ignore-load: frame counts are about that load as much as the page`;
    return null;
  }
  if (b.busy && !frames) {
    // Counted work moves little with the load (it is what holds budgets on noisy CI runners): it runs, and
    // says it ran on a busy machine.
    ctx.loadNote = `counted on a busy machine (${Math.round(b.share * 100)}% CPU): counts hold, times run high`;
    return null;
  }
  if (!b.busy && frames && !ctx.flags.headless && !ctx.flags['ignore-display']) {
    // The CPU is free; is the display? Other apps drawing keep the GPU busy, which no CPU share shows.
    const probe = await displayProbe().catch(() => null);
    if (probe && !probe.ok) return { status: 'not-measurable', summary: `the display is busy: a blank page's animation, drawn by the compositor alone, had ${probe.late} of ${probe.frames} frames late (${Math.round(probe.share * 100)}%). Other apps are keeping the GPU busy, and the page's frames would be about them. Close or hide what is animating (a video, a window that redraws), or pass --ignore-display.`, evidence: [{ probe }], next: ['frameproof doctor', 'the same command once the display is quiet, or with --ignore-display'] };
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

/** The serving mode the records saw, as one line, or '' when the page had no local subframes (ADR 0001 D1). */
export function modeNote(records) {
  const apart = new Set();
  const together = new Set();
  const pages = new Set();
  // Hosts without their ports: a static server takes a new port each block, and the mode is the same.
  const host = (h) => String(h).replace(/:\d+$/, '');
  for (const r of records) {
    if (!r?.mode) continue;
    if (r.mode.page) pages.add(host(r.mode.page));
    for (const h of r.mode.apart ?? []) apart.add(host(h));
    for (const h of r.mode.together ?? []) together.add(host(h));
  }
  if (!apart.size && !together.size) return '';
  // (A step whose trace didn't name its main frame's url has no page host: the others say it.)
  pages.delete('');
  const parts = [];
  if (apart.size) parts.push(`frames from ${[...apart].join(', ')} ran in their own process`);
  if (together.size) parts.push(`frames from ${[...together].join(', ')} shared the page's process`);
  return `mode: ${pages.size ? `page on ${[...pages].join(', ')}; ` : ''}${parts.join('; ')}`;
}

/** A records' mode as a key: two builds measured in different modes aren't the same experiment. */
export const modeKey = (records) => {
  const apart = new Set();
  for (const r of records) for (const h of r?.mode?.apart ?? []) apart.add(h.replace(/:\d+$/, ''));
  return [...apart].sort().join(',');
};

/** Each cell's base median, by machine and build, so a run can say when its base reads unlike the last
    one: numbers from separate runs don't compare (ADR 0001 D2). Returns the notes, by cell. */
export function baseDrift(ctx, { run, build, results }) {
  const file = join(dirOf(ctx.root), 'cells.json');
  const all = readJson(file, {});
  const notes = {};
  for (const v of results) {
    const median = v.typical?.base;
    if (typeof median !== 'number') continue;
    const key = `${ctx.machine.id}|${build.key}|${v.id}`;
    const last = all[key];
    if (last && last.run !== run.id) {
      const gap = Math.abs(median - last.median);
      if (gap > (v.margin ?? 2) && gap > 0.25 * Math.max(median, last.median)) notes[v.id] = `the base read ${median} here and ${last.median} in ${last.run}: numbers from separate runs don't compare, only the two builds within one run do`;
    }
    all[key] = { median, run: run.id };
  }
  writeJson(file, all);
  return notes;
}
