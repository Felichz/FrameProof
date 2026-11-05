// init: adds frameproof to a project and overwrites nothing. The config (with the framework's defaults),
// perf/GOALS.md (the questions only a person can answer), perf/JOURNAL.md, perf/scenarios/, perf/budgets.js,
// a marked block in AGENTS.md so later sessions know the tool is there, the same for Claude Code as a skill
// when the project uses it, and .frameproof/ in .gitignore.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { detectFramework } from '../config.mjs';

/** How a project runs the tool. Until it is on npm, from GitHub; after, `npx frameproof@latest`. */
export const INVOKE = 'npx -y github:Felichz/FrameProof';

export const GOALS_MARK = '<!-- frameproof: unanswered. Ask the person these questions, write the answers, then delete this line. -->';

const GOALS = `# Performance goals

${GOALS_MARK}

What only a person knows, written down so that an agent doesn't have to ask again, and doesn't settle a
trade-off by itself. frameproof gives evidence; the decisions are here.

## Which interactions matter most?

In order. Name the scenario that measures each, in backticks, once it exists (built in: \`load\`, \`idle\`,
\`scroll\`).

1. \`scroll\`:

## What counts as a modest machine?

Which CPU throttle stands for the people who use this, on this machine. For example: "4x stands for a
school Chromebook". Compare runs at 1x and at this.

- Throttle: 4x

## What won't you trade away?

Things that stay even when they cost frames: an animation, a look, a feature. A change that alters what a
visitor sees, or when, is the person's call.

-

## Decided so far

Answers to trade-offs as they come up, with the date, so they aren't asked twice.

-
`;

const JOURNAL = `# Performance journal

What was tried, and what came of it, newest last. \`frameproof compare\` and \`frameproof price\` add to it;
edit it freely. Read it before starting: a dead end tried once doesn't need trying again without a new reason.
`;

const BUDGETS = `// Budgets over counted work, checked by \`frameproof check\` (exit 1 on a break, for CI). Each rule reads one
// scenario's step and says the most it may cost; the least count over the repetitions is what's checked.
// \`r\` holds the totals (rafs, timers, forced, styles, layouts, paints, scriptMs, styleMs, layoutMs, busyMs,
// styleElements, layoutObjects) and two helpers: r.asked(kind, /where/) for frames ('rAF') or timers ('timer')
// asked for from a source location, and r.forced(kind, /where/) for style or layout forced there.
// Start from what \`frameproof ledger -s idle\` shows, and lower a rule when a change lowers its count for good.
export default [
  { scenario: 'idle', step: 'rest', says: 'at rest, nothing asks for frames', count: (r) => r.rafs, max: 0 },
  { scenario: 'idle', step: 'rest', says: 'at rest, nothing lays out', count: (r) => r.layouts, max: 0 },
];
`;

const BLOCK_START = '<!-- frameproof:start -->';
const BLOCK_END = '<!-- frameproof:end -->';
export const AGENTS_BLOCK = `${BLOCK_START}
## Performance: frameproof

This project measures frames with frameproof. Before changing anything for performance, run
\`${INVOKE} next\` and do what it says; \`${INVOKE} guide\` has the manual for the installed
version. Read \`perf/GOALS.md\` (what matters, and what isn't traded away) and \`perf/JOURNAL.md\` (what was
tried) first. Judge a change only with \`frameproof compare\`, and report \`inconclusive\` as "not known",
never as "no difference". Don't open trace files or write parsers: ask \`frameproof query\`.
${BLOCK_END}
`;

const SKILL = `---
name: frameproof
description: Measure whether a web change made frames smoother, find what froze and why, and hold performance budgets. Use when asked to make a page smoother, fix stutter, jank or freezes, or check a change's performance.
---

Run \`${INVOKE} next\` from the project root and do what it says, one step at a time. It covers
setup. \`${INVOKE} guide [topic]\` is the manual for the installed version.

- Read \`perf/GOALS.md\` and \`perf/JOURNAL.md\` first. The goals are the person's; ask them when they're empty.
- Judge a change only with \`frameproof compare\`. \`inconclusive\` means "not known", never "no difference".
- Don't open trace files or write parsers: \`frameproof query <run> <what>\` answers from the run.
- Don't kill processes you didn't start; when the machine is busy, wait.
`;

export default async function init(ctx) {
  const root = ctx.root;
  const written = [];
  const kept = [];
  const put = (rel, text) => {
    const file = join(root, rel);
    if (existsSync(file)) return kept.push(rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    written.push(rel);
  };
  const fw = detectFramework(root);
  const build = fw.build ? `{ command: ${JSON.stringify(fw.build)}, out: ${JSON.stringify(fw.out)} }` : 'null';
  const serve = typeof fw.serve === 'string' ? `'${fw.serve}'` : JSON.stringify(fw.serve);
  const config = `// frameproof's config. Detected: ${fw.name}. Guide: ${INVOKE} guide config
export default {
  // How to build (null: the files are served as they are). Source maps give real names in every output:
  // ${fw.maps}.
  build: ${build},
  ${fw.build ? '' : `out: ${JSON.stringify(fw.out)},\n  `}// 'static' serves the build's folder; { command, url } starts a server ({port} is filled in); { url } is a site already up.
  serve: ${serve},
  // The page the scenarios start from.
  path: '/',
  scenarios: './perf/scenarios',
  budgets: './perf/budgets.js',
};
`;
  if (!['frameproof.config.js', 'frameproof.config.mjs'].some((f) => existsSync(join(root, f)))) put('frameproof.config.js', config);
  else kept.push('frameproof.config.js');
  put('perf/GOALS.md', GOALS);
  put('perf/JOURNAL.md', JOURNAL);
  put('perf/budgets.js', BUDGETS);
  if (!existsSync(join(root, 'perf/scenarios'))) {
    mkdirSync(join(root, 'perf/scenarios'), { recursive: true });
    writeFileSync(join(root, 'perf/scenarios/.gitkeep'), '');
    written.push('perf/scenarios/');
  }

  // A marked block in AGENTS.md: appended once, replaced by nothing else.
  const agents = join(root, 'AGENTS.md');
  const current = existsSync(agents) ? readFileSync(agents, 'utf8') : null;
  if (!current) {
    writeFileSync(agents, AGENTS_BLOCK);
    written.push('AGENTS.md');
  } else if (!current.includes(BLOCK_START)) {
    appendFileSync(agents, `${current.endsWith('\n') ? '' : '\n'}\n${AGENTS_BLOCK}`);
    written.push('AGENTS.md (a marked block appended)');
  } else kept.push('AGENTS.md');
  if (existsSync(join(root, '.claude')) || existsSync(join(root, 'CLAUDE.md'))) put('.claude/skills/frameproof/SKILL.md', SKILL);

  const gi = join(root, '.gitignore');
  const ignore = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (!/^\.frameproof\/?$/m.test(ignore)) {
    appendFileSync(gi, `${ignore && !ignore.endsWith('\n') ? '\n' : ''}.frameproof/\n`);
    written.push('.gitignore (.frameproof/)');
  }
  return {
    status: 'ok',
    summary: `frameproof added (${fw.name} detected): ${written.length} written, ${kept.length} already there and kept. Next, perf/GOALS.md needs the person's answers.`,
    evidence: [{ written, kept, framework: fw.name, sourceMaps: fw.maps }].map((e) => ({ ...e, written: e.written.map((w) => relative(root, join(root, w)) || w) })),
    next: ['frameproof next'],
  };
}
