// affected: the scenarios that run the changed files. What each scenario runs is recorded, with JS and CSS
// coverage mapped to source files, whenever `scenario check` or `ledger` runs it. A changed file no
// scenario runs is said out loud: a change nothing measures can't be judged.
import { string } from '../cli/args.mjs';
import { changedFiles, dirtyFiles, isGit } from '../builds.mjs';
import { allScenarios } from '../scenarios.mjs';
import { coverageFile } from '../session.mjs';
import { readJson } from '../store.mjs';

const norm = (f) => f.replaceAll('\\', '/').replace(/^\.\//, '');
const SOURCE = /\.(m?[jt]sx?|vue|svelte|astro|css|scss|sass|less|html)$/;

export async function affectedScenarios(ctx, base, head) {
  const changed = changedFiles(ctx.root, base, head).map(norm).filter((f) => SOURCE.test(f) && !/^(perf|test|tests|e2e)\//.test(f) && !/\.(test|spec)\./.test(f));
  const cov = readJson(coverageFile(ctx.config), {});
  const { list } = await allScenarios(ctx.config);
  const scenarios = [];
  const unknown = [];
  const runsIt = new Map();
  for (const s of list) {
    const files = cov[s.name]?.files?.map(norm);
    if (!files) {
      unknown.push(s.name);
      continue;
    }
    const hits = changed.filter((c) => files.some((f) => f === c || f.endsWith('/' + c) || c.endsWith('/' + f)));
    if (hits.length) scenarios.push(s.name);
    for (const h of hits) runsIt.set(h, [...(runsIt.get(h) ?? []), s.name]);
  }
  const orphan = changed.filter((c) => !runsIt.has(c));
  return { changed, scenarios, unknown, orphan, runsIt: Object.fromEntries(runsIt) };
}

export default async function affected(ctx) {
  const head = string(ctx.flags, 'head', 'worktree');
  const base = string(ctx.flags, 'base', isGit(ctx.root) && head === 'worktree' && dirtyFiles(ctx.root).length ? 'HEAD' : 'HEAD~1');
  const a = await affectedScenarios(ctx, base, head);
  const parts = [`${a.changed.length} changed source file(s) between ${base} and ${head}`];
  parts.push(a.scenarios.length ? `run by: ${a.scenarios.join(', ')}` : 'no scenario with coverage runs them');
  if (a.orphan.length) parts.push(`${a.orphan.length} run by no scenario (${a.orphan.slice(0, 3).join(', ')}${a.orphan.length > 3 ? ', ...' : ''}): a change there can't be judged until one does`);
  if (a.unknown.length) parts.push(`no coverage yet for ${a.unknown.join(', ')}`);
  const next = [];
  if (a.scenarios.length) next.push(`frameproof compare --base ${base} --head ${head} -s ${a.scenarios.join(',')}`);
  for (const u of a.unknown.slice(0, 2)) next.push(`frameproof scenario check ${u}`);
  return { status: 'ok', summary: parts.join('; ') + '.', evidence: [{ scenarios: a.scenarios, runsIt: a.runsIt, orphan: a.orphan, noCoverage: a.unknown }], next };
}
