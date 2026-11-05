// wait: blocks until a background run is done, then prints what it printed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { number, UsageError } from '../cli/args.mjs';
import { sleep } from '../browser.mjs';
import { alive, Run } from '../store.mjs';

export default async function wait(ctx) {
  const run = Run.open(ctx.root, ctx.args[0]);
  if (!run) throw new UsageError(`no run ${ctx.args[0] ?? '(latest)'}`, ['frameproof journal']);
  const end = Date.now() + number(ctx.flags, 'minutes', 60) * 60_000;
  const out = join(run.dir, 'output.json');
  for (;;) {
    const meta = new Run(ctx.root, run.id).meta;
    if (meta.state === 'done' && existsSync(out) && readFileSync(out, 'utf8').trim()) {
      const env = JSON.parse(readFileSync(out, 'utf8'));
      return { ...env, run: run.id };
    }
    if (meta.state === 'done') return { status: meta.result?.status ?? 'ok', summary: meta.result?.summary ?? `${run.id} is done`, run: run.id, next: [`frameproof show ${run.id}`] };
    if (meta.pid && !alive(meta.pid)) {
      const log = existsSync(join(run.dir, 'progress.log')) ? readFileSync(join(run.dir, 'progress.log'), 'utf8').trim().split('\n').slice(-6) : [];
      if (existsSync(out) && readFileSync(out, 'utf8').trim()) return { ...JSON.parse(readFileSync(out, 'utf8')), run: run.id };
      return { status: 'error', summary: `${run.id} stopped before it finished`, run: run.id, evidence: [{ lastProgress: log }], next: [`frameproof show ${run.id}`] };
    }
    // Not a result: a run still going says so in its status, never `ok`.
    if (Date.now() > end) return { status: 'running', summary: `${run.id} is still running after ${number(ctx.flags, 'minutes', 60)} min of waiting: ${run.steps().length} steps so far`, run: run.id, next: [`frameproof wait ${run.id}`] };
    await sleep(2000);
  }
}
