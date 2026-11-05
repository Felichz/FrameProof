// journal: the experiments so far, from perf/JOURNAL.md (which compare and price append to, and people edit).
import { number } from '../cli/args.mjs';
import { journalFile, readText } from './_shared.mjs';

export function entries(text) {
  return text
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [title, ...body] = block.split('\n');
      const field = (name) => new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`).exec(body.join('\n'))?.[1]?.trim();
      return { title: title.trim(), hypothesis: field('Hypothesis'), change: field('Change'), result: field('Result'), run: field('Run')?.split(' ')[0] };
    });
}

export default async function journal(ctx) {
  const text = readText(journalFile(ctx));
  if (!text) return { status: 'ok', summary: `no journal yet at ${ctx.config.journal}: compare and price start it`, next: ['frameproof next'] };
  const all = entries(text);
  const last = all.slice(-number(ctx.flags, 'n', 8)).reverse();
  return { status: 'ok', summary: `${all.length} experiment(s) in ${ctx.config.journal}, newest first. Don't retry a dead end without a new reason`, evidence: last, next: last[0]?.run ? [`frameproof show ${last[0].run}`] : ['frameproof next'] };
}
