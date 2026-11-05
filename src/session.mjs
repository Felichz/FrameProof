// What every measuring command shares: a build served, its profile kept warm, blocks run and alternated,
// progress told on stderr (stdout carries only the envelope), and the time budget.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareBuild } from './builds.mjs';
import { display } from './machine.mjs';
import { hasProfile, profileDir, runBlock } from './runner.mjs';
import { serveBuild } from './serve.mjs';

export const progress = (line) => process.stderr.write(`frameproof: ${line}\n`);

/** Whether frames can be judged here, and how the browser should run. */
export function browserMode(flags) {
  const d = display();
  if (flags.headless) return { headless: true, show: false, label: 'headless (asked for): frame counts are not a screen\'s' };
  if (!d.ok) return { headless: true, show: false, label: `headless: ${d.why}`, noFrames: d.why };
  return { headless: false, show: !!flags.show, label: null, note: d.note };
}

/** A build, made ready once per command: built (or found in the cache) and given its profile folder. */
export function ready(config, ref, flags = {}) {
  progress(`preparing ${ref}`);
  const build = prepareBuild(config, ref, { fresh: !!flags.rebuild });
  // The files as they are now keep one warm profile across edits, as a visitor's browser does; a commit has its own.
  build.profileKey = build.ref === 'worktree' ? 'worktree' : build.key;
  return build;
}

/**
 * Runs blocks on one build and returns their records. `plan` is a list of scenarios. A new profile is
 * warmed first (one unmeasured pass), unless `--cold`.
 */
export async function blocks({ config, build, plan, reps, throttle = 1, depth, inject, run, tag = 'a', block = 0, flags = {}, keep, coverage = false, onStep }) {
  const served = await serveBuild(config, build);
  const mode = browserMode(flags);
  const cold = !!flags.cold;
  const profile = cold ? undefined : profileDir(config, build.profileKey + (mode.headless ? '-headless' : ''));
  const warm = !cold && !hasProfile(config, build.profileKey + (mode.headless ? '-headless' : ''));
  try {
    progress(`${tag === 'b' ? 'head' : tag === 'a' ? 'base' : tag} ${build.label}, block ${block + 1}: ${plan.map((s) => s.name).join(', ')} x${reps}${throttle > 1 ? ` at ${throttle}x CPU` : ''}${inject ? `, inject ${inject}` : ''}${warm ? ' (warming a new profile first)' : ''}`);
    const out = await runBlock({ config, build, served, plan, reps, throttle, depth, inject, profile, warm, show: mode.show, headless: mode.headless, run, tag, block, keep, coverage, onStep: (r) => {
      run?.addStep(r);
      onStep?.(r);
    } });
    return { ...out, mode };
  } finally {
    await served.close();
  }
}

export class Clock {
  constructor(minutes) {
    this.end = Date.now() + minutes * 60_000;
  }
  left() {
    return this.end - Date.now();
  }
  ok() {
    return this.left() > 0;
  }
}

export const coverageFile = (config) => join(config.root, '.frameproof', 'coverage.json');
export const exists = existsSync;
