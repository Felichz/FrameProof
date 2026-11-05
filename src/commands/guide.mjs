// guide: the manual, from the installed package, so it always matches the version that runs.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../cli/args.mjs';

const DIR = fileURLToPath(new URL('../../guide/', import.meta.url));

export function topics() {
  return readdirSync(DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort((a, b) => (a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b)));
}

export default async function guide(ctx) {
  const topic = ctx.args[0] ?? 'index';
  const file = join(DIR, `${topic}.md`);
  if (!existsSync(file)) throw new UsageError(`no guide topic "${topic}". Topics: ${topics().join(', ')}`, ['frameproof guide']);
  const text = readFileSync(file, 'utf8');
  const title = /^# (.+)$/m.exec(text)?.[1] ?? topic;
  return { status: 'ok', summary: `guide: ${title}`, text, evidence: [{ topics: topics() }], next: ['frameproof next'], full: true };
}
