// The entry: parse, find the project, run one command, print its envelope, return the exit code.
import { execFileSync, spawn } from 'node:child_process';
import { openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, loadConfig } from '../config.mjs';
import { fingerprint } from '../machine.mjs';
import { dirOf, ensure, newRunId, Run } from '../store.mjs';
import { parseArgs, UsageError } from './args.mjs';
import { envelope, print } from './envelope.mjs';

const COMMANDS = {
  next: () => import('../commands/next.mjs'),
  guide: () => import('../commands/guide.mjs'),
  doctor: () => import('../commands/doctor.mjs'),
  init: () => import('../commands/init.mjs'),
  scenario: () => import('../commands/scenario.mjs'),
  calibrate: () => import('../commands/calibrate.mjs'),
  compare: () => import('../commands/compare.mjs'),
  price: () => import('../commands/price.mjs'),
  freezes: () => import('../commands/freezes.mjs'),
  bisect: () => import('../commands/bisect.mjs'),
  show: () => import('../commands/show.mjs'),
  query: () => import('../commands/query.mjs'),
  ledger: () => import('../commands/ledger.mjs'),
  check: () => import('../commands/check.mjs'),
  affected: () => import('../commands/affected.mjs'),
  journal: () => import('../commands/journal.mjs'),
  report: () => import('../commands/report.mjs'),
  wait: () => import('../commands/wait.mjs'),
};
/** How many positional arguments each command takes: one more is a mistake, said as one (an argument that
    passed quietly sent an agent the wrong way for hours: `show <run> f4` printed the run, not f4). */
const ARITY = { next: 0, guide: 1, doctor: 0, init: 0, scenario: 2, calibrate: 0, compare: 0, price: 0, freezes: 0, bisect: Infinity, show: 3, query: 2, ledger: 0, check: 0, affected: 0, journal: 0, report: 1, wait: 1 };
/** The guide topic that documents each command, for `<command> --help`. */
const TOPIC = { next: 'index', guide: 'index', doctor: 'machine', init: 'config', scenario: 'scenarios', calibrate: 'machine', compare: 'compare', price: 'compare', freezes: 'freezes', bisect: 'bisect', show: 'freezes', query: 'freezes', ledger: 'budgets', check: 'budgets', affected: 'compare', journal: 'goals', report: 'verdicts', wait: 'index' };

/** Which frameproof answered: the package's version, and its commit when it runs from a clone. */
let toolId;
export function tool() {
  if (toolId) return toolId;
  const dir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  let version = '?';
  try {
    version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  } catch {}
  let commit = '';
  try {
    // (cwd, not -C: Git reads a C: path given to -C as a remote host on Windows, as builds.mjs does.)
    const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    commit = git(['rev-parse', '--short', 'HEAD']);
    if (git(['status', '--porcelain', '--', 'src', 'bin', 'guide'])) commit += ', dirty';
  } catch {}
  return (toolId = `frameproof ${version}${commit ? ` (${commit})` : ''}`);
}

/** The commands that measure, and so may run for minutes: they take --background. */
const LONG = new Set(['calibrate', 'compare', 'price', 'freezes', 'bisect', 'ledger', 'check', 'scenario']);

export const HELP = `frameproof: frame-level performance evidence for web apps, for coding agents.

Start with: frameproof next   (it says the one thing to do now, with its command)

  next                      the one thing to do now
  guide [topic]             the manual for this version
  doctor                    can this machine measure right now?
  init                      add the config, goals, journal and scenarios folder
  scenario check <file>     run a scenario once and say what each step really did
  calibrate -s <scenario>   noise floor, smallest effect visible, repetitions needed
  compare --base --head     alternated A/B, with a verdict
  price --inject <css|js>   what a change would be worth, before making it
  freezes -s <scenario>     freezes grouped by cause
  bisect -s <s> <cand>...   which part of the page (or which commit) holds the frames
  show <id> [section]       one freeze's dossier, or one run
  query <run> <what>        hot, forced, askers, threads, long-tasks, failures
  ledger -s <scenario>      counted work per step
  check                     budgets; exit 1 on a break, for CI
  affected                  the scenarios that run the changed files
  journal                   the experiments so far
  report [run]              the result written for a person
  wait <run>                block until a background run is done

Every command prints one JSON envelope: { status, summary, machine, run, evidence, next }.
Exit codes: 0 verdict or done, 1 regression or broken budget, 2 not measurable, 3 usage.`;

export async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    return print(envelope({ status: 'error', summary: e.message, next: ['frameproof guide'] }));
  }
  const [name, ...rest] = args._;
  const flags = args.flags;
  const opts = { full: !!flags.full, pretty: true };
  if (!name || name === 'help' || (flags.help && !name)) {
    return print(envelope({ status: 'ok', summary: 'frameproof, and its commands. Start with `frameproof next`.', text: HELP, next: ['frameproof next'] }), { ...opts, full: true });
  }
  const load = COMMANDS[name];
  if (!load) return print(envelope({ status: 'error', summary: `no command "${name}"`, evidence: [{ commands: Object.keys(COMMANDS) }], next: ['frameproof help'] }), opts);
  if (flags.help) {
    const guide = await (await COMMANDS.guide()).default({ args: [TOPIC[name] ?? 'index'], flags: {} });
    return print(envelope({ ...guide, summary: `${name}: ${guide.summary}`, next: [`frameproof guide ${TOPIC[name] ?? 'index'}`], tool: tool() }), { ...opts, full: true });
  }
  if (rest.length > (ARITY[name] ?? Infinity)) {
    const extra = rest.slice(ARITY[name]);
    const hint = name === 'show' ? ['frameproof show <run>/<fN> [section]', 'frameproof show <run>'] : [`frameproof ${name} --help`];
    return print(envelope({ status: 'error', summary: `${name} takes ${ARITY[name] || 'no'} argument${ARITY[name] === 1 ? '' : 's'}; ${extra.map((x) => `"${x}"`).join(', ')} would be ignored, so nothing ran`, next: hint, tool: tool() }), opts);
  }

  const root = findRoot(flags.root ?? process.cwd());
  try {
    const config = await loadConfig(root);
    if (flags.background && LONG.has(name)) return print(background(root, name, argv), opts);
    if (LONG.has(name) && !flags['no-keep-awake']) keepAwake();
    const mod = await load();
    let machine;
    const ctx = {
      root,
      config,
      flags,
      args: rest,
      get machine() {
        return (machine ??= fingerprint());
      },
    };
    const env = await mod.default(ctx);
    if (env.machine === undefined || env.machine === null) env.machine = ctx.machine.id;
    env.tool ??= tool();
    const { rest: restCmd, full: whole, ...body } = env;
    return print(envelope(body), { ...opts, rest: restCmd, full: opts.full || whole === true });
  } catch (e) {
    if (e instanceof UsageError) return print(envelope({ status: 'error', summary: e.message, next: e.next.length ? e.next : [`frameproof guide ${TOPIC[name] ?? 'index'}`], tool: tool() }), opts);
    if (process.env.FRAMEPROOF_DEBUG) process.stderr.write(`${e.stack}\n`);
    return print(envelope({ status: 'error', tool: tool(), summary: `${name} failed: ${e.message.split('\n')[0]}`, evidence: e.message.includes('\n') ? [{ detail: e.message.split('\n').slice(1, 14).join('\n') }] : [], next: ['frameproof doctor'] }), opts);
  }
}

/**
 * While a command measures, the machine stays awake with its display on: a Mac that sleeps or dims its
 * screen draws no frames, and a long run left alone stopped halfway, more than once, with nothing to say
 * why. On macOS, `caffeinate` asserts it for exactly as long as this process lives (-w), and lets go on its
 * own when the process ends, however it ends. Nothing is changed in the system's settings.
 * `--no-keep-awake` leaves the machine to its own settings.
 */
function keepAwake() {
  if (process.platform !== 'darwin') return;
  try {
    spawn('caffeinate', ['-dims', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();
    // -d keeps the display on, but not the session unlocked: a Mac set to lock after a while idle locked
    // halfway through a run, and a locked screen hides Chrome's window (its browser then went away). The
    // user is declared active every 25 s while the command runs (caffeinate -u, 30 s each), and no
    // longer once it ends. It doesn't stop a lock asked for by hand, or a closed lid.
    const active = () => spawn('caffeinate', ['-u', '-t', '30'], { stdio: 'ignore', detached: true }).unref();
    active();
    setInterval(active, 25_000).unref();
  } catch {}
}

/** The same command in a process of its own, writing to a run folder that can be read at any time. */
function background(root, name, argv) {
  const id = newRunId();
  const dir = ensure(join(dirOf(root), 'runs', id));
  const run = Run.create(root, { command: name, argv, background: true }, id);
  const out = openSync(join(dir, 'output.json'), 'w');
  const err = openSync(join(dir, 'progress.log'), 'w');
  const bin = fileURLToPath(new URL('../../bin/frameproof.mjs', import.meta.url));
  const child = spawn(process.execPath, [bin, ...argv.filter((a) => a !== '--background'), '--run-id', id], { cwd: process.cwd(), detached: true, stdio: ['ignore', out, err] });
  child.unref();
  run.save({ pid: child.pid });
  return envelope({ status: 'ok', summary: `${name} is running in the background as ${id}`, run: id, evidence: [{ progress: `.frameproof/runs/${id}/progress.log` }], next: [`frameproof wait ${id}`] });
}
