// report: a run written for a person, for a PR or a chat. The wording is tied to the status, so it can't
// turn `inconclusive` into "no difference", or a p-value into a decision.
import { UsageError } from '../cli/args.mjs';
import { Run } from '../store.mjs';
import { signed } from './_shared.mjs';

const SAY = {
  better: (c) => `Improved by ${-c.effect.lateFrames} late frames a step (95% interval ${range(c.effect.interval, -1)}), confirmed on fresh repetitions.`,
  worse: (c) => `Regressed by ${c.effect.lateFrames} late frames a step (95% interval ${range(c.effect.interval)}), confirmed on fresh repetitions.`,
  same: (c) => `No change larger than the margin of ±${c.margin} late frames a step (interval ${range(c.effect.interval)}).`,
  inconclusive: (c) => `Not known: ${c.reason}. This is not "no difference".`,
  invalid: (c) => `Not judged: ${c.reason}.`,
  'not-measurable': (c) => `Unmeasured: ${c.reason}.`,
};

const range = ([lo, hi], sign = 1) => (sign > 0 ? `${signed(lo)} to ${signed(hi)}` : `${round(-hi)} to ${round(-lo)} fewer`);
const round = (v) => +v.toFixed(2);

function compareReport(m) {
  const r = m.result;
  const lines = [`### Frame check: ${r.head} against ${r.base}`, '', `**${title(r.status)}.** ${r.summary}`, ''];
  lines.push('| Step | Verdict | What it means | Typical late frames (base → head) | Rare stalls (base vs head) | Repetitions |', '|---|---|---|---|---|---|');
  for (const c of r.cells) lines.push(`| ${c.id} | ${c.verdict} | ${(SAY[c.verdict] ?? SAY.inconclusive)(c)} | ${c.typical ? `${c.typical.base} → ${c.typical.head}` : '-'} | ${c.episodes ? `${c.episodes.base} vs ${c.episodes.head}` : '-'} | ${c.n ? `${c.n.base} + ${c.n.head}` : '-'} |`);
  lines.push('', note(m));
  return lines.join('\n');
}

const title = (s) => ({ better: 'Better', worse: 'Worse', same: 'No change beyond the margin', inconclusive: 'Not known', invalid: 'Not judged', 'not-measurable': 'Unmeasured', ok: 'Done', failed: 'Budget broken' })[s] ?? s;
const note = (m) => `<sub>frameproof, run ${m.id} on ${m.machine?.id ?? 'this machine'}: builds alternated in one session; late frames counted from Chrome's compositor. Numbers from another machine or day are not comparable. The verdict is evidence, not a decision.</sub>`;

function freezesReport(m) {
  const r = m.result;
  const lines = [`### Freezes on ${r.ref}${r.throttle > 1 ? ` at ${r.throttle}x CPU` : ''}`, '', r.summary, ''];
  if (r.groups?.length) {
    lines.push('| | Where | In | Length | Cause |', '|---|---|---|---|---|');
    for (const g of r.groups.slice(0, 10)) lines.push(`| ${g.id} | ${g.scenario} ${g.step} | ${g.in}/${g.of} | ${g.minMs}-${g.maxMs} ms | ${g.example} |`);
  }
  const uncovered = (r.journeys ?? []).flatMap((j) => j.blocks ?? []).filter((b) => !b.covered);
  if (uncovered.length) {
    lines.push('', 'Outside every step (from the journey):', '');
    for (const b of uncovered.slice(0, 6)) lines.push(`- ${b.ms} ms ${b.where}: ${b.verdict}`);
  }
  lines.push('', note(m));
  return lines.join('\n');
}

function genericReport(m) {
  const r = m.result ?? {};
  const lines = [`### frameproof ${m.command}`, '', `**${title(r.status ?? 'ok')}.** ${r.summary ?? ''}`, ''];
  const rows = r.results ?? r.cells ?? r.steps;
  if (Array.isArray(rows) && rows.length) {
    const keys = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object').slice(0, 6);
    lines.push(`| ${keys.join(' | ')} |`, `|${keys.map(() => '---').join('|')}|`);
    for (const row of rows.slice(0, 20)) lines.push(`| ${keys.map((k) => String(row[k] ?? '')).join(' | ')} |`);
  }
  lines.push('', note(m));
  return lines.join('\n');
}

export default async function report(ctx) {
  const run = Run.open(ctx.root, ctx.args[0] === 'latest' ? null : ctx.args[0]);
  if (!run) throw new UsageError(`no run ${ctx.args[0] ?? '(latest)'}`, ['frameproof journal']);
  const m = run.meta;
  if (m.state !== 'done') return { status: 'ok', summary: `${run.id} is still running`, run: run.id, next: [`frameproof wait ${run.id}`] };
  const text = m.command === 'compare' || m.command === 'price' ? compareReport({ ...m, result: { base: m.result.base ?? `${m.ref ?? 'worktree'} without the injection`, head: m.result.head ?? `with ${m.inject}`, ...m.result } }) : m.command === 'freezes' ? freezesReport(m) : genericReport(m);
  return { status: 'ok', summary: `the result of ${run.id} (${m.command}), written for a person: paste the text as it is`, run: run.id, text, next: [], full: true };
}
